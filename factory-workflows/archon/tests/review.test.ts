import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fixerOutput, reReviewOutput, reviewOutput } from '../.archon/workflows/codagent/.shared/lib/review-output.ts';
import {
  activeFindings, addFindings, applyActions, applyVerdicts, currentCycle, emptyState, findingText,
  handedOff, handoff, renderResult, settled, startCycle, type Defect, type FindingState, type ReviewState,
} from '../.archon/workflows/codagent/.shared/lib/review.ts';
import { createSandbox, type Sandbox } from './helpers.ts';

const scripts = resolve(import.meta.dir, '../.archon/workflows/codagent/implement-change/scripts');
const defect = (overrides: Partial<Defect> = {}): Defect => ({ title: 'Handle missing config', file: 'file.txt',
  line: 0, severity: 'high', category: 'error-handling', problem: 'Missing config crashes', fix: 'Catch missing file', ...overrides });
function cycle(state: ReviewState, round = 0): void {
  startCycle(state, { place: round ? 'acceptance' : 'before-pr', round, start: 'base', end: 'head' });
}
function stateWithFinding(): ReviewState {
  const state = emptyState();
  cycle(state);
  addFindings(state, [defect()]);
  return state;
}
const act = (state: ReviewState, action: 'fixed' | 'declined' | 'replied') =>
  applyActions(state, [{ id: 'R1', action, note: `fixer ${action}` }]);
const judge = (state: ReviewState, verdict: 'confirmed' | 'rejected' | 'accepted' | 'contested') =>
  applyVerdicts(state, [{ id: 'R1', verdict, reason: `reviewer ${verdict}` }]);

function checkInvalidState(status: FindingState, perform: (state: ReviewState) => void): void {
  const state = stateWithFinding(); const finding = state.findings[0];
  if (!finding) throw new Error('missing finding');
  finding.state = status; perform(state);
  expect(finding.state).toBe(status); expect(finding.history).toHaveLength(0);
  expect(state.ignored).toHaveLength(1); expect(renderResult(state)).toContain('invalid action');
}
function checkInvalidActions(status: FindingState): void {
  const allowedFixer: Partial<Record<FindingState, string[]>> = { open: ['fixed', 'declined'], contested: ['fixed', 'replied'] };
  const allowedReviewer: Partial<Record<FindingState, string[]>> = {
    fixed: ['confirmed', 'rejected'], declined: ['accepted', 'contested'], replied: ['accepted', 'contested'],
  };
  const actions = (['fixed', 'declined', 'replied'] as const).filter(action => !allowedFixer[status]?.includes(action));
  const verdicts = (['confirmed', 'rejected', 'accepted', 'contested'] as const)
    .filter(verdict => !allowedReviewer[status]?.includes(verdict));
  for (const action of actions) checkInvalidState(status, state => act(state, action));
  for (const verdict of verdicts) checkInvalidState(status, state => judge(state, verdict));
}

describe('review finding state', () => {
  test('allocates sequential run-wide IDs, open states and complete histories', () => {
    const state = stateWithFinding();
    act(state, 'fixed'); judge(state, 'confirmed');
    cycle(state, 1); addFindings(state, [defect({ severity: 'medium' }), defect({ severity: 'low' })]);
    expect(state.findings.map(f => f.id)).toEqual(['R1', 'R2', 'R3']);
    expect(state.findings.map(f => f.state)).toEqual(['closed', 'open', 'open']);
    expect(state.findings[0]?.history).toEqual([
      { round: 1, actor: 'fixer', action: 'fixed', note: 'fixer fixed' },
      { round: 1, actor: 'reviewer', action: 'confirmed', note: 'reviewer confirmed' },
    ]);
    expect(state.findings[1]).toMatchObject({ cycle: 1, contested: false, handed_off: false });
  });
  test('permits every fixer and reviewer transition including rejected fix and accepted decline', () => {
    const state = stateWithFinding();
    act(state, 'fixed'); expect(state.findings[0]?.state).toBe('fixed');
    judge(state, 'rejected'); expect(state.findings[0]?.state).toBe('open');
    act(state, 'declined'); expect(state.findings[0]?.state).toBe('declined');
    judge(state, 'contested'); expect(state.findings[0]?.state).toBe('contested');
    act(state, 'fixed'); judge(state, 'confirmed');
    expect(state.findings[0]?.state).toBe('closed');
    const declined = stateWithFinding(); act(declined, 'declined'); judge(declined, 'accepted');
    expect(declined.findings[0]).toMatchObject({ state: 'closed', accepted_decline: true });
  });
  test('ignores invalid states, unknown IDs, omitted and handed-off findings without changing them', () => {
    const states: FindingState[] = ['open', 'fixed', 'declined', 'contested', 'replied', 'closed', 'disputed'];
    for (const status of states) {
      const state = stateWithFinding();
      const finding = state.findings[0];
      if (!finding) throw new Error('missing finding');
      finding.state = status;
      applyActions(state, [{ id: 'unknown', action: 'fixed', note: '' }]);
      applyVerdicts(state, [{ id: 'unknown', verdict: 'accepted', reason: '' }]);
      expect(finding.state).toBe(status);
      finding.handed_off = true;
      act(state, 'fixed'); judge(state, 'confirmed');
      expect(finding.state).toBe(status);
      expect(state.ignored).toHaveLength(4);
      expect(renderResult(state)).toContain('Ignored unknown');
    }
    const state = stateWithFinding(); judge(state, 'confirmed'); act(state, 'replied');
    expect(state.findings[0]?.state).toBe('open');
    applyActions(state, []); expect(state.findings[0]?.state).toBe('open');
    expect(state.ignored).toHaveLength(2);
  });
  test('every disallowed fixer action and reviewer verdict preserves each finding state', () => {
    const states: FindingState[] = ['open', 'fixed', 'declined', 'contested', 'replied', 'closed', 'disputed'];
    for (const status of states) checkInvalidActions(status);
  });
  test('contest happens once; second and third turns settle accepted replies or disputed findings', () => {
    for (const verdict of ['accepted', 'contested'] as const) {
      const state = stateWithFinding();
      act(state, 'declined'); judge(state, 'contested');
      expect(settled(state)).toBe(false);
      act(state, 'replied'); expect(state.findings[0]?.state).toBe('replied');
      judge(state, verdict);
      expect(state.findings[0]?.state).toBe(verdict === 'accepted' ? 'closed' : 'disputed');
      expect(settled(state)).toBe(true);
      expect(activeFindings(state)).toHaveLength(0);
      act(state, 'fixed'); expect(state.ignored).toHaveLength(1);
    }
    const state = stateWithFinding();
    act(state, 'declined'); judge(state, 'contested');
    act(state, 'fixed'); judge(state, 'rejected');
    act(state, 'declined'); judge(state, 'contested');
    expect(currentCycle(state).turn).toBe(3);
    expect(state.findings[0]?.state).toBe('disputed');
    expect(settled(state)).toBe(true);
  });
  test('new findings of every severity keep a cycle unsettled and prompts include debate reasons', () => {
    const state = stateWithFinding(); act(state, 'declined'); judge(state, 'contested');
    expect(findingText(state)).toContain('fixer declined');
    expect(findingText(state)).toContain('reviewer contested');
    act(state, 'replied'); judge(state, 'accepted');
    addFindings(state, ['high', 'medium', 'low'].map(severity => defect({ severity: severity as Defect['severity'] })));
    expect(activeFindings(state).map(f => f.severity)).toEqual(['high', 'medium', 'low']);
    expect(settled(state)).toBe(false);
    expect(findingText(state)).not.toContain('R1 [');
  });
});

describe('review rendering and handoff', () => {
  test('empty review says exactly No findings and result shows ranges, ignored actions and blocked reason', () => {
    const state = emptyState(); cycle(state);
    expect(renderResult(state)).toContain('\nNo findings.\n');
    addFindings(state, [defect()]); act(state, 'declined'); judge(state, 'contested');
    act(state, 'replied'); judge(state, 'contested'); act(state, 'fixed');
    currentCycle(state).blocked = 'credential missing';
    const text = renderResult(state);
    for (const expected of ['base..head', '[disputed]', 'Ignored R1', 'credential missing', 'reviewer contested']) {
      expect(text).toContain(expected);
    }
  });
  test('handoff includes high medium unresolved and accepted declines with both sides and required fields', () => {
    const state = stateWithFinding(); act(state, 'declined'); judge(state, 'contested');
    act(state, 'replied'); judge(state, 'contested');
    addFindings(state, [defect({ severity: 'medium', title: 'Accepted' }), defect({ severity: 'low', title: 'Low' })]);
    applyActions(state, [{ id: 'R2', action: 'declined', note: 'intentional compatibility' }]);
    applyVerdicts(state, [{ id: 'R2', verdict: 'accepted', reason: 'agreed' }]);
    currentCycle(state).blocked = 'missing access';
    const ledger = handoff(state, 'No unresolved assumptions or context gaps.\n');
    for (const expected of ['## Review finding R1', '## Review finding R2', 'Question:', 'Requirement:', 'Ruling:',
      'Rationale:', 'Pending decision:', 'fixer declined', 'reviewer contested', 'fixer replied', 'missing access',
      'intentional compatibility', 'The reviewer accepted it.', 'review/before-pr.md']) expect(ledger).toContain(expected);
    expect(ledger).not.toContain('## Review finding R3');
    expect(ledger).not.toContain('No unresolved assumptions');
    expect(renderResult(state)).toContain('Low');
    expect(handedOff(state)).toContain('R2: Accepted (file.txt:0)');
    expect(handoff(state, ledger)).toBe(ledger);
  });
  test('confirmed fixes add nothing; unfinished earlier cycles hand off and latest acceptance result replaces earlier cycle', () => {
    const state = stateWithFinding(); act(state, 'fixed'); judge(state, 'confirmed');
    expect(handoff(state, 'ledger')).toBe('ledger');
    cycle(state, 1); addFindings(state, [defect({ title: 'Unfinished' })]);
    cycle(state, 2); addFindings(state, [defect({ title: 'Latest' })]);
    const ledger = handoff(state, '');
    expect(ledger).toContain('acceptance round 1'); expect(ledger).toContain('acceptance round 2');
    const text = renderResult(state);
    expect(text).toContain('Latest'); expect(text).not.toContain('Unfinished');
    expect(activeFindings(state)).toHaveLength(0);
  });
});

describe('review output validation', () => {
  test('accepts required schemas and rejects absent malformed or extra review fields with node and output location', () => {
    expect(reviewOutput(JSON.stringify({ findings: [defect()] }), 'review-change').findings).toHaveLength(1);
    expect(fixerOutput('{"blocked":false,"reason":"","actions":[]}', 'fix').blocked).toBe(false);
    expect(reReviewOutput('{"verdicts":[],"findings":[]}', 're-review').verdicts).toEqual([]);
    const invalid = [undefined, '', 'not-json', '[]', '{}', '{"findings":{},"extra":0}',
      JSON.stringify({ findings: [defect({ line: 1.5 })] }), JSON.stringify({ findings: [{ ...defect(), extra: 1 }] }),
      JSON.stringify({ findings: [{ ...defect(), severity: 'urgent' }] }),
      JSON.stringify({ findings: [{ ...defect(), category: 'style' }] })];
    for (const text of invalid) expect(() => reviewOutput(text, 'review-change')).toThrow('review-change');
    expect(() => reviewOutput('{}', 'review-change')).toThrow('nodes/review-change.md');
    expect(() => fixerOutput('{"blocked":false,"reason":"","actions":[{"id":"R1","action":"skip","note":""}]}', 'fix')).toThrow();
    expect(() => reReviewOutput('{"verdicts":[{"id":"R1","verdict":"skip","reason":""}],"findings":[]}', 'again')).toThrow();
  });
});

interface OutputSchema {
  type: 'object' | 'boolean' | 'string' | 'integer';
  properties?: Record<string, OutputSchema>;
  required?: string[];
  additionalProperties?: boolean;
}
interface ScriptNode { script?: string; output_format?: OutputSchema; loop_group?: { nodes: ScriptNode[] } }
const workflow = Bun.YAML.parse(readFileSync(join(scripts, '../implement-change.yaml'), 'utf8')) as { nodes: ScriptNode[] };
const flattenNodes = (entries: ScriptNode[]): ScriptNode[] => entries.flatMap(entry => [entry, ...flattenNodes(entry.loop_group?.nodes ?? [])]);
const outputSchemas = new Map(flattenNodes(workflow.nodes).filter(entry => entry.script && entry.output_format)
  .map(entry => [entry.script, entry.output_format]));
function checkOutput(name: string, value: Record<string, unknown>): void {
  const schema = outputSchemas.get(name);
  if (!schema) throw new Error(`No output schema for ${name}`);
  expect(Object.keys(value).sort()).toEqual(Object.keys(schema.properties ?? {}).sort());
  expect(schema.additionalProperties).toBe(false);
  for (const key of schema.required ?? []) expect(Object.hasOwn(value, key)).toBe(true);
  for (const [key, field] of Object.entries(schema.properties ?? {})) {
    expect(typeof value[key]).toBe(field.type === 'integer' ? 'number' : field.type);
    if (field.type === 'integer') expect(Number.isInteger(value[key])).toBe(true);
  }
}

let box: Sandbox;
let artifacts: string;
beforeEach(() => { box = createSandbox(); artifacts = join(box.binDir, 'artifacts'); mkdirSync(artifacts); });
afterEach(() => box.dispose());
function run(name: string, inputs: Record<string, unknown> = {}, fails = false): Record<string, unknown> {
  const env: NodeJS.ProcessEnv = { ...process.env, ARTIFACTS_DIR: artifacts };
  for (const [key, value] of Object.entries(inputs)) env[`INPUTS_${key.toUpperCase()}`] =
    typeof value === 'string' ? value : JSON.stringify(value);
  const output = spawnSync(process.execPath, [join(scripts, `${name}.ts`)], { cwd: box.dir, env, encoding: 'utf8' });
  if (fails) { expect(output.status).toBe(1); return { error: output.stderr }; }
  expect(output.stderr).toBe(''); expect(output.status).toBe(0);
  const parsed = JSON.parse(output.stdout) as Record<string, unknown>;
  expect(output.stdout.trim().split('\n')).toHaveLength(1);
  checkOutput(name, parsed);
  return parsed;
}
const read = (file: string): string => readFileSync(join(artifacts, file), 'utf8');
const persisted = (): ReviewState => JSON.parse(read('review/state.json')) as ReviewState;
function prepare(mode: string, start = '', round = 0): Record<string, unknown> {
  return run('prepare-review', { mode, place: mode === 'acceptance' ? 'acceptance' : 'before-pr',
    start, change_dir: 'openspec/changes/demo', round });
}
function record(prepared: Record<string, unknown>, findings: Defect[] = [], mode = 'initial'): void {
  const output = run('record-review', { ...prepared, mode, review_name: 'review-change', result: { findings } });
  expect(Object.keys(output).sort()).toEqual(['findings', 'settled']);
}

describe('INT-007 review scripts against real git', () => {
  test('whole-change range excludes definition; invalid start and moved review head fail explicitly', () => {
    const start = box.head(); box.commitFix('changed\n');
    box.write('openspec/changes/demo/proposal.md', 'definition'); box.git('add', '.'); box.commit('definition');
    const prepared = prepare('initial', start);
    expect(Object.keys(prepared).sort()).toEqual(['end', 'files', 'findings', 'handed_off', 'needed', 'start']);
    expect(prepared.needed).toBe(true); expect(prepared.files).toBe('file.txt');
    for (const bad of ['', 'missing-revision']) {
      const output = run('prepare-review', { mode: 'initial', place: 'before-pr', start: bad, change_dir: 'openspec/changes/demo' }, true);
      expect(output.error).toContain(bad ? 'cannot read start revision' : 'start revision is empty');
    }
    box.commitFix('reviewer moved head\n');
    const failed = run('record-review', { ...prepared, review_name: 'review-change', result: { findings: [] } }, true);
    expect(failed.error).toContain('review-change: HEAD moved');
    expect(run('record-review', { ...prepare('initial', start), review_name: 'review-change', result: '{}' }, true).error)
      .toContain('invalid findings shape');
  });
  test('missing and malformed results and re-review head movement fail with named output location', () => {
    const start = box.head(); box.commitFix(); const prepared = prepare('initial', start);
    const input = { ...prepared, review_name: 'review-change' };
    expect(run('record-review', input, true).error).toContain('nodes/review-change.md');
    record(prepared, [defect()]);
    const fixInput = { review_name: 'fix-review-findings' };
    expect(run('record-review-fixes', fixInput, true).error).toContain('fix-review-findings');
    expect(run('record-review-fixes', { ...fixInput, result: { blocked: false } }, true).error).toContain('invalid findings shape');
    const endInput = { end: box.head(), blocked: false, review_name: 're-review' };
    expect(run('end-review-round', endInput, true).error).toContain('nodes/re-review.md');
    expect(run('end-review-round', { ...endInput, result: { verdicts: [] } }, true).error).toContain('invalid findings shape');
    box.commitFix('reviewer committed incorrectly');
    expect(run('end-review-round', { ...endInput, result: { verdicts: [], findings: [] } }, true).error)
      .toContain('re-review: HEAD moved');
  });
  test('disputed ledger persists both sides and no later cycle handles handed-off findings', () => {
    const start = box.head(); box.commitFix(); record(prepare('initial', start), [defect()]);
    for (const action of ['declined', 'replied']) {
      const fixed = run('record-review-fixes', { review_name: 'fix-review-findings', result: { blocked: false, reason: '',
        actions: [{ id: 'R1', action, note: `fixer ${action} because compatibility` }] } });
      run('end-review-round', { blocked: false, end: fixed.end, review_name: 're-review', result: {
        verdicts: [{ id: 'R1', verdict: 'contested', reason: `reviewer disagrees with ${action}` }], findings: [] } });
    }
    run('hand-off-review');
    const ledger = read('acceptance-assumptions.md');
    for (const text of ['## Review finding R1', 'fixer declined because compatibility', 'fixer replied because compatibility',
      'reviewer disagrees with declined', 'reviewer disagrees with replied', 'review/before-pr.md']) expect(ledger).toContain(text);
    expect(read('review/before-pr.md')).toContain('[disputed]');
    expect(persisted().findings[0]).toMatchObject({ state: 'disputed', handed_off: true });
    box.commitFix('later'); expect(prepare('acceptance', '', 1).handed_off).toContain('R1:');
  });
  test('empty range needs no reviewer and records No findings at exact head', () => {
    const prepared = prepare('initial', box.head()); expect(prepared.needed).toBe(false);
    record(prepared);
    expect(read('review/before-pr.md')).toContain('No findings.');
    expect(persisted().last_reviewed).toBe(box.head());
    const tail = prepare('tail'); expect(tail.needed).toBe(false);
    run('hand-off-review'); expect(existsSync(join(artifacts, 'acceptance-assumptions.md'))).toBe(false);
  });
  test('tail covers a head moved only by an excluded definition commit', () => {
    record(prepare('initial', box.head()));
    box.write('openspec/changes/demo/proposal.md', 'definition'); box.git('add', '.'); box.commit('definition');
    const tail = prepare('tail'); expect(tail.needed).toBe(true); expect(tail.files).toBe('');
    record(tail, [], 'tail');
    expect(persisted().last_reviewed).toBe(box.head());
    expect(read('review/before-pr.md')).toContain(box.head());
  });
  test('same-head tail skips even when an unclosed low finding remains', () => {
    const start = box.head(); box.commitFix();
    record(prepare('initial', start), [defect({ severity: 'low' })]);
    run('hand-off-review');
    const tail = prepare('tail');
    expect(tail.needed).toBe(false);
    expect(persisted().cycles).toHaveLength(1);
  });
  test('fix and re-review scripts maintain incremental revision, blocked commits get tail review and handoff is idempotent', () => {
    const start = box.head(); box.commitFix();
    record(prepare('initial', start), [defect(), defect({ severity: 'medium', title: 'Declined' }), defect({ severity: 'low', title: 'Low' })]);
    const reviewed = box.head(); box.commitFix('fixer partial fix\n');
    const fixed = run('record-review-fixes', { review_name: 'fix-review-findings', result: { blocked: true,
      reason: 'missing credential', actions: [{ id: 'R1', action: 'fixed', note: 'partial fix' }] } });
    expect(fixed).toMatchObject({ blocked: true, start: reviewed, end: box.head() });
    const end = run('end-review-round', { blocked: true }); expect(end.stop).toBe(true);
    expect(persisted().last_reviewed).toBe(reviewed);
    const tail = prepare('tail'); expect(tail).toMatchObject({ needed: true, start: reviewed, end: box.head() });
    record(tail, [defect({ title: 'Tail defect' })], 'tail');
    expect(persisted().last_reviewed).toBe(box.head());
    expect(read('review/before-pr.md')).toContain(box.head());
    const ledger = read('acceptance-assumptions.md');
    expect(ledger).toContain('missing credential'); expect(ledger).toContain('Tail defect');
    expect(ledger).not.toContain('## Review finding R3');
    run('hand-off-review'); expect(read('acceptance-assumptions.md')).toBe(ledger);
  });
  test('acceptance includes tracked working tree and re-review uses last covered revision; verdicts and output replacement persist', () => {
    record(prepare('initial', box.head()));
    const last = box.head(); box.write('file.txt', 'uncommitted acceptance fix\n');
    const prepared = prepare('acceptance', '', 1);
    expect(prepared).toMatchObject({ needed: true, start: last, end: last, files: 'file.txt' });
    record(prepared, [defect(), defect({ severity: 'medium' })]);
    box.commit('acceptance fix', 'file.txt');
    const fixed = run('record-review-fixes', { review_name: 'fix-round-findings', result: { blocked: false, reason: '', actions: [
      { id: 'R1', action: 'fixed', note: 'fixed' }, { id: 'R2', action: 'declined', note: 'compatibility' }] } });
    expect(fixed.start).toBe(last);
    const output = run('end-review-round', { end: fixed.end, blocked: false, review_name: 'round-re-review', result: {
      verdicts: [{ id: 'R1', verdict: 'confirmed', reason: 'resolved' }, { id: 'R2', verdict: 'accepted', reason: 'agreed' }], findings: [] } });
    expect(output.stop).toBe(true);
    writeFileSync(join(artifacts, 'acceptance-assumptions.md'), 'No unresolved assumptions or context gaps.\n');
    run('hand-off-review'); const ledger = read('acceptance-assumptions.md');
    expect(ledger).not.toContain('Review finding R1'); expect(ledger).toContain('Review finding R2');
    expect(ledger).toContain('compatibility'); expect(ledger).not.toContain('No unresolved assumptions');
    box.commitFix('second round\n');
    const next = prepare('acceptance', '', 2);
    expect(next.start).toBe(fixed.end); expect(next.handed_off).toContain('R2:');
    record(next, [defect({ title: 'new round' })]);
    expect(read('review/acceptance.md')).toContain('new round');
    expect(read('review/acceptance.md')).not.toContain('Handle missing config');
    expect(persisted().findings.map(f => f.id)).toEqual(['R1', 'R2', 'R3']);
  });
});
