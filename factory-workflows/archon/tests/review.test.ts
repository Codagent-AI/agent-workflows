import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  activeFindings, addFindings, applyActions, applyVerdicts, currentCycle, emptyState, findingText,
  handedOff, handoff, reopenRequested, renderResult, settled, startCycle, type Defect, type FindingState, type ReviewState,
} from '../.archon/workflows/codagent/.shared/lib/review.ts';
import { collectReview, initialChoice, missingAnswers, sizeTotals } from '../.archon/workflows/codagent/.shared/lib/review-send.ts';
import { applyRewrite, flagItems, passingRewrite, readerItems, readerNotes } from '../.archon/workflows/codagent/.shared/lib/review-reader.ts';
import { markReviewRoundDone, pendingReviewRound, reviewedCommits } from '../.archon/workflows/codagent/.shared/lib/review-revisions.ts';
import { settleQuestions } from '../.archon/workflows/codagent/.shared/lib/review-questions.ts';
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
  applyActions(state, [{ id: 'REVIEW-1', action, note: `fixer ${action}` }]);
const judge = (state: ReviewState, verdict: 'confirmed' | 'rejected' | 'accepted' | 'contested') =>
  applyVerdicts(state, [{ id: 'REVIEW-1', verdict, reason: `reviewer ${verdict}` }]);

function checkInvalidState(status: FindingState, perform: (state: ReviewState) => void): void {
  const state = stateWithFinding(); const finding = state.findings[0];
  if (!finding) throw new Error('missing finding');
  finding.state = status; perform(state);
  expect(finding.state).toBe(status); expect(finding.history).toHaveLength(0);
  expect(state.ignored).toHaveLength(1); expect(renderResult(state)).toContain('invalid action');
}
function checkInvalidActions(status: FindingState): void {
  const allowedFixer: Partial<Record<FindingState, string[]>> = { open: ['fixed', 'declined'], contested: ['fixed', 'replied'] };
  const allowedReviewer: Partial<Record<FindingState, string[]>> = { fixed: ['confirmed', 'rejected'], declined: ['accepted', 'contested'], replied: ['accepted', 'contested'] };
  const actions = (['fixed', 'declined', 'replied'] as const).filter(action => !allowedFixer[status]?.includes(action));
  const verdicts = (['confirmed', 'rejected', 'accepted', 'contested'] as const).filter(verdict => !allowedReviewer[status]?.includes(verdict));
  for (const action of actions) checkInvalidState(status, state => act(state, action));
  for (const verdict of verdicts) checkInvalidState(status, state => judge(state, verdict));
}

describe('review finding state', () => {
  test('allocates sequential run-wide IDs, open states and complete histories', () => {
    const state = stateWithFinding();
    act(state, 'fixed'); judge(state, 'confirmed');
    cycle(state, 1); addFindings(state, [defect({ severity: 'medium' }), defect({ severity: 'low' })]);
    expect(state.findings.map(f => f.id)).toEqual(['REVIEW-1', 'REVIEW-2', 'REVIEW-3']);
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
      const state = stateWithFinding(); const finding = state.findings[0];
      if (!finding) throw new Error('missing finding'); finding.state = status;
      applyActions(state, [{ id: 'unknown', action: 'fixed', note: '' }]);
      applyVerdicts(state, [{ id: 'unknown', verdict: 'accepted', reason: '' }]);
      expect(finding.state).toBe(status); finding.handed_off = true;
      act(state, 'fixed'); judge(state, 'confirmed');
      expect(finding.state).toBe(status);
      expect(state.ignored).toHaveLength(4); expect(renderResult(state)).toContain('Ignored unknown');
    }
    const state = stateWithFinding(); judge(state, 'confirmed'); act(state, 'replied'); expect(state.findings[0]?.state).toBe('open');
    applyActions(state, []); expect(state.findings[0]?.state).toBe('open');
    expect(state.ignored).toHaveLength(2);
  });
  test('every disallowed fixer action and reviewer verdict preserves each finding state', () => {
    const states: FindingState[] = ['open', 'fixed', 'declined', 'contested', 'replied', 'closed', 'disputed'];
    for (const status of states) checkInvalidActions(status);
  });
  test('ignored submissions retain attempted action, actor, note and the actual rejection reason', () => {
    const state = stateWithFinding();
    applyActions(state, [{ id: 'unknown', action: 'fixed', note: 'unknown attempt' }]);
    judge(state, 'confirmed');
    const first = state.findings[0]; if (!first) throw new Error('missing finding');
    first.handed_off = true; act(state, 'declined');
    const result = renderResult(state);
    cycle(state, 1); addFindings(state, [defect()]); cycle(state, 2);
    applyVerdicts(state, [{ id: 'REVIEW-2', verdict: 'accepted', reason: 'earlier cycle' }]);
    expect(state.ignored.map(entry => [entry.actor, entry.action, entry.note, entry.reason])).toEqual([
      ['fixer', 'fixed', 'unknown attempt', 'unknown finding ID'],
      ['reviewer', 'confirmed', 'reviewer confirmed', 'invalid action for finding state open'],
      ['fixer', 'declined', 'fixer declined', 'finding was already handed off'],
      ['reviewer', 'accepted', 'earlier cycle', 'finding belongs to a different cycle'],
    ]);
    expect(state.ignored[0]).toMatchObject({ cycle: 0, id: 'unknown', round: 1 });
    expect(result).toContain('Ignored unknown: fixer fixed (unknown attempt); unknown finding ID');
    expect(result).toContain('Ignored REVIEW-1: reviewer confirmed (reviewer confirmed); invalid action for finding state open');
    expect(result).toContain('Ignored REVIEW-1: fixer declined (fixer declined); finding was already handed off');
    expect(state.findings.map(entry => entry.state)).toEqual(['open', 'open']);
  });
  test('contest happens once; second and third turns settle accepted replies or disputed findings', () => {
    for (const verdict of ['accepted', 'contested'] as const) {
      const state = stateWithFinding();
      act(state, 'declined'); judge(state, 'contested');
      expect(settled(state)).toBe(false);
      act(state, 'replied'); expect(state.findings[0]?.state).toBe('replied');
      judge(state, verdict);
      expect(state.findings[0]?.state).toBe(verdict === 'accepted' ? 'closed' : 'disputed');
      expect(settled(state)).toBe(true); expect(activeFindings(state)).toHaveLength(0);
      act(state, 'fixed'); expect(state.ignored).toHaveLength(1);
    }
    const state = stateWithFinding(); act(state, 'declined'); judge(state, 'contested');
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
    expect(findingText(state)).not.toContain('REVIEW-1 [');
  });
});

describe('review rendering and handoff', () => {
  test('empty review says exactly No open findings and result shows ranges, ignored actions and blocked reason', () => {
    const state = emptyState(); cycle(state);
    expect(renderResult(state)).toContain('\nNo open findings.\n');
    addFindings(state, [defect()]); act(state, 'declined'); judge(state, 'contested');
    act(state, 'replied'); judge(state, 'contested'); act(state, 'fixed');
    currentCycle(state).blocked = 'credential missing';
    const text = renderResult(state);
    for (const expected of ['base..head', '[disputed]', 'Ignored REVIEW-1', 'credential missing', 'reviewer contested']) {
      expect(text).toContain(expected);
    }
  });
  test('handoff includes high medium unresolved and accepted declines with both sides and required fields', () => {
    const state = stateWithFinding(); act(state, 'declined'); judge(state, 'contested');
    act(state, 'replied'); judge(state, 'contested');
    addFindings(state, [defect({ severity: 'medium', title: 'Accepted' }), defect({ severity: 'low', title: 'Low' })]);
    applyActions(state, [{ id: 'REVIEW-2', action: 'declined', note: 'intentional compatibility' }]);
    applyVerdicts(state, [{ id: 'REVIEW-2', verdict: 'accepted', reason: 'agreed' }]);
    currentCycle(state).blocked = 'missing access';
    const ledger = handoff(state, 'No unresolved assumptions or context gaps.\n');
    for (const expected of ['## Review finding REVIEW-1', '## Review finding REVIEW-2', 'Question:', 'Requirement:', 'Decision:',
      'Rationale:', 'fixer declined', 'reviewer contested', 'fixer replied', 'missing access',
      'intentional compatibility', 'The reviewer accepted it.', 'review/before-pr.md']) expect(ledger).toContain(expected);
    expect(ledger).not.toContain('## Review finding REVIEW-3');
    expect(ledger).not.toContain('No unresolved assumptions');
    expect(renderResult(state)).toContain('Low');
    expect(handedOff(state)).toContain('REVIEW-2: Accepted (file.txt:0)');
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
function checkOutput(schema: OutputSchema, value: Record<string, unknown>): void {
  const properties = schema.properties ?? {};
  expect(schema.additionalProperties).toBe(false);
  for (const key of schema.required ?? []) expect(Object.hasOwn(value, key)).toBe(true);
  for (const [key, actual] of Object.entries(value)) {
    expect(Object.hasOwn(properties, key)).toBe(true);
    const type = properties[key].type;
    expect(typeof actual).toBe(type === 'integer' ? 'number' : type);
    if (type === 'integer') expect(Number.isInteger(actual)).toBe(true);
  }
}

test('review script output check permits optional fields and enforces required and declared fields', () => {
  const schema: OutputSchema = {
    type: 'object', properties: { files: { type: 'string' }, revisions: { type: 'string' } },
    required: ['files'], additionalProperties: false,
  };
  expect(() => checkOutput(schema, { files: 'file.txt' })).not.toThrow();
  expect(() => checkOutput(schema, { files: 'file.txt', revisions: 'abc' })).not.toThrow();
  expect(() => checkOutput(schema, { revisions: 'abc' })).toThrow();
  expect(() => checkOutput(schema, { files: 'file.txt', revisions: 123 })).toThrow();
  expect(() => checkOutput(schema, { files: 'file.txt', unexpected: '' })).toThrow();
});

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
  const schema = outputSchemas.get(name);
  if (!schema) throw new Error(`No output schema for ${name}`);
  checkOutput(schema, parsed);
  return parsed;
}
const read = (file: string): string => readFileSync(join(artifacts, file), 'utf8');
const persisted = (): ReviewState => JSON.parse(read('review/state.json')) as ReviewState;
// What Archon binds from `$<node>.execution.checkoutStart` for a clean checkout.
const observation = (commit: string): string => JSON.stringify({ kind: 'git', commit, worktree: { status: 'clean' } });
function prepare(mode: string, start = '', round = 0): Record<string, unknown> {
  return run('prepare-review', { mode, place: mode === 'acceptance' ? 'acceptance' : 'before-pr',
    start: mode === 'initial' ? observation(start) : start, change_dir: 'openspec/changes/demo', round });
}
function record(prepared: Record<string, unknown>, findings: Defect[] = [], mode = 'initial'): void {
  const output = run('record-review', { ...prepared, mode, review_name: 'review-change', result: { findings } });
  expect(Object.keys(output).sort()).toEqual(['findings', 'settled']);
}

describe('INT-009 review scripts against real git', () => {
  test('whole-change range excludes definition; invalid start and moved review head fail explicitly', () => {
    const start = box.head(); box.commitFix('changed\n');
    box.write('openspec/changes/demo/proposal.md', 'definition'); box.git('add', '.'); box.commit('definition');
    const prepared = prepare('initial', start);
    expect(Object.keys(prepared).sort()).toEqual(['end', 'files', 'findings', 'handed_off', 'needed', 'start']);
    expect(prepared.needed).toBe(true); expect(prepared.files).toBe('file.txt');
    const bad: [string, string][] = [['', 'could not read where the node started'],
      [JSON.stringify({ kind: 'not_git' }), 'the checkout is not_git'], [observation('0'.repeat(40)), 'cannot read start revision']];
    for (const [badStart, error] of bad) {
      const output = run('prepare-review', { mode: 'initial', place: 'before-pr', start: badStart, change_dir: 'openspec/changes/demo' }, true);
      expect(output.error).toContain(error);
    }
    box.commitFix('reviewer moved head\n');
    const failed = run('record-review', { ...prepared, review_name: 'review-change', result: { findings: [] } }, true);
    expect(failed.error).toContain('review-change: HEAD moved');
  });
  test('missing and malformed results and re-review head movement fail with named output location', () => {
    const start = box.head(); box.commitFix(); const prepared = prepare('initial', start);
    const input = { ...prepared, review_name: 'review-change' };
    expect(run('record-review', input, true).error).toContain('nodes/review-change.md');
    record(prepared, [defect()]);
    const fixInput = { review_name: 'fix-review-findings' };
    expect(run('record-review-fixes', fixInput, true).error).toContain('fix-review-findings');
    const endInput = { end: box.head(), blocked: false, review_name: 're-review' };
    expect(run('end-review-round', endInput, true).error).toContain('nodes/re-review.md');
    box.commitFix('reviewer committed incorrectly');
    expect(run('end-review-round', { ...endInput, result: { verdicts: [], findings: [] } }, true).error)
      .toContain('re-review: HEAD moved');
  });
  test('disputed ledger persists both sides and no later cycle handles handed-off findings', () => {
    const start = box.head(); box.commitFix(); record(prepare('initial', start), [defect()]);
    for (const action of ['declined', 'replied']) {
      const fixed = run('record-review-fixes', { review_name: 'fix-review-findings', result: { blocked: false, reason: '',
        actions: [{ id: 'REVIEW-1', action, note: `fixer ${action} because compatibility` }] } });
      run('end-review-round', { blocked: false, end: fixed.end, review_name: 're-review', result: {
        verdicts: [{ id: 'REVIEW-1', verdict: 'contested', reason: `reviewer disagrees with ${action}` }], findings: [] } });
    }
    run('hand-off-review');
    const ledger = read('dispute-log.md');
    for (const text of ['## Review finding REVIEW-1', 'fixer declined because compatibility', 'fixer replied because compatibility',
      'reviewer disagrees with declined', 'reviewer disagrees with replied', 'review/before-pr.md']) expect(ledger).toContain(text);
    expect(read('review/before-pr.md')).toContain('[disputed]');
    expect(persisted().findings[0]).toMatchObject({ state: 'disputed', handed_off: true });
    box.commitFix('later'); expect(prepare('acceptance', '', 1).handed_off).toContain('REVIEW-1:');
  });
  test('empty range needs no reviewer and records No open findings at exact head', () => {
    const prepared = prepare('initial', box.head()); expect(prepared.needed).toBe(false);
    record(prepared);
    expect(read('review/before-pr.md')).toContain('No open findings.');
    expect(persisted().last_reviewed).toBe(box.head());
    const tail = prepare('tail'); expect(tail.needed).toBe(false);
    run('hand-off-review'); expect(existsSync(join(artifacts, 'dispute-log.md'))).toBe(false);
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
      reason: 'missing credential', actions: [{ id: 'REVIEW-1', action: 'fixed', note: 'partial fix' }] } });
    expect(fixed).toMatchObject({ blocked: true, start: reviewed, end: box.head() });
    const end = run('end-review-round', { blocked: true }); expect(end.stop).toBe(true);
    expect(persisted().last_reviewed).toBe(reviewed);
    const tail = prepare('tail'); expect(tail).toMatchObject({ needed: true, start: reviewed, end: box.head() });
    record(tail, [defect({ title: 'Tail defect' })], 'tail');
    expect(persisted().last_reviewed).toBe(box.head());
    expect(read('review/before-pr.md')).toContain(box.head());
    const ledger = read('dispute-log.md');
    expect(ledger).toContain('missing credential'); expect(ledger).toContain('Tail defect');
    expect(ledger).not.toContain('## Review finding REVIEW-3');
    run('hand-off-review'); expect(read('dispute-log.md')).toBe(ledger);
  });
  test('one acceptance fixer turn hands off contested declines with both sides before any reply', () => {
    record(prepare('initial', box.head()));
    box.commitFix('acceptance change\n');
    const prepared = prepare('acceptance', '', 1);
    record(prepared, [defect(), defect({ severity: 'medium' })]);
    const fixed = run('record-review-fixes', { review_name: 'fix-round-findings', result: { blocked: false, reason: '',
      actions: ['REVIEW-1', 'REVIEW-2'].map(id => ({ id, action: 'declined', note: `compatibility ${id}` })) } });
    const ended = run('end-review-round', { end: fixed.end, blocked: false, review_name: 'round-re-review', result: {
      verdicts: ['REVIEW-1', 'REVIEW-2'].map(id => ({ id, verdict: 'contested', reason: `unsafe behavior ${id}` })), findings: [] } });
    expect(ended.stop).toBe(false);
    run('hand-off-review');
    const state = persisted();
    expect(currentCycle(state).turn).toBe(1);
    expect(state.findings.map(entry => entry.state)).toEqual(['contested', 'contested']);
    for (const finding of state.findings) {
      expect(finding.handed_off).toBe(true);
      expect(finding.history.map(entry => entry.action)).toEqual(['declined', 'contested']);
      const ledger = read('dispute-log.md');
      for (const expected of [`## Review finding ${finding.id}, acceptance round 1`, finding.problem,
        finding.fix, `compatibility ${finding.id}`, `unsafe behavior ${finding.id}`, 'review/acceptance.md']) {
        expect(ledger).toContain(expected);
      }
      expect(read('review/acceptance.md')).toContain(`${finding.id}: ${finding.title} [contested]`);
    }
  });
  test('acceptance includes tracked working tree and re-review uses last covered revision; verdicts and output replacement persist', () => {
    record(prepare('initial', box.head()));
    const last = box.head(); box.write('file.txt', 'uncommitted acceptance fix\n');
    const prepared = prepare('acceptance', '', 1);
    expect(prepared).toMatchObject({ needed: true, start: last, end: last, files: 'file.txt' });
    record(prepared, [defect(), defect({ severity: 'medium' })]);
    box.commit('acceptance fix', 'file.txt');
    const fixed = run('record-review-fixes', { review_name: 'fix-round-findings', result: { blocked: false, reason: '', actions: [
      { id: 'REVIEW-1', action: 'fixed', note: 'fixed' }, { id: 'REVIEW-2', action: 'declined', note: 'compatibility' }] } });
    expect(fixed.start).toBe(last);
    const output = run('end-review-round', { end: fixed.end, blocked: false, review_name: 'round-re-review', result: {
      verdicts: [{ id: 'REVIEW-1', verdict: 'confirmed', reason: 'resolved' }, { id: 'REVIEW-2', verdict: 'accepted', reason: 'agreed' }], findings: [] } });
    expect(output.stop).toBe(true);
    writeFileSync(join(artifacts, 'decision-log.md'), 'No unresolved assumptions or context gaps.\n');
    run('hand-off-review'); const ledger = read('decision-log.md');
    expect(ledger).not.toContain('Review finding REVIEW-1'); expect(ledger).toContain('Review finding REVIEW-2');
    expect(ledger).toContain('compatibility'); expect(ledger).not.toContain('No unresolved assumptions');
    box.commitFix('second round\n');
    const next = prepare('acceptance', '', 2);
    expect(next.start).toBe(fixed.end); expect(next.handed_off).toContain('REVIEW-2:');
    record(next, [defect({ title: 'new round' })]);
    expect(read('review/acceptance.md')).toContain('new round');
    expect(read('review/acceptance.md')).not.toContain('Handle missing config');
    expect(persisted().findings.map(f => f.id)).toEqual(['REVIEW-1', 'REVIEW-2', 'REVIEW-3']);
  });
});

test.each(['confirmed', 'rejected'] as const)('a feedback review reopens only a requested logged finding and records it %s', verdict => {
  const state = stateWithFinding();
  addFindings(state, [defect({ title: 'Other handed-off finding' })]);
  handoff(state, '');
  startCycle(state, { place: 'feedback', round: 2, start: 'previous', end: 'next' });
  reopenRequested(state, 'Fix REVIEW-1 only');
  expect(activeFindings(state).map(finding => finding.id)).toEqual(['REVIEW-1']);
  judge(state, verdict);
  expect(state.findings[0].state).toBe(verdict === 'confirmed' ? 'closed' : 'open');
  expect(state.findings[1].handed_off).toBe(true);
  expect(renderResult(state)).toContain('previous..next');
});

test.each(['Other', 'note', 'plain text', 'custom option'])('feedback review reopens a logged finding requested through %s', source => {
  const state = stateWithFinding();
  handoff(state, '');
  mkdirSync(join(artifacts, 'review'), { recursive: true });
  writeFileSync(join(artifacts, 'review/state.json'), JSON.stringify(state));
  const answer = join(artifacts, 'review-answers-round-1.json');
  writeFileSync(answer, JSON.stringify({ round: 1, answers: [{ item: 'DISPUTE-1', option: 'custom' }], note: source }));
  writeFileSync(join(artifacts, 'review-response-round-1.json'), JSON.stringify([{ item: 'note', status: 'fixed', requestedFindings: ['REVIEW-1'] }]));
  const start = box.head();
  const changed = box.commitFix('feedback fix\n');
  const review = run('prepare-review', { mode: 'feedback', place: 'feedback', start,
    change_dir: 'openspec/changes/demo', round: 2, answers_file: answer });
  expect(review.revisions).toBe(changed);
  expect(review.findings).toContain('REVIEW-1 [fixed');
});

test('a review round answer starts the feedback review before the late commit it names', () => {
  const [before, late, answer, other] = [box.head(), box.commitFix('late fix\n'), join(artifacts, 'review-answers-round-1.json'), 'b'.repeat(40)];
  mkdirSync(join(artifacts, 'review'), { recursive: true }); writeFileSync(join(artifacts, 'review/pages.json'), JSON.stringify([{ round: 1, file: 'review-page-round-1.html', head: late }]));
  writeFileSync(join(artifacts, 'review-page-round-1.html'), `<script type="application/json" id="page-data">${JSON.stringify({ orange: [{ source: ['DECIDE-2', late, other], questions: [{ prompt: 'Shared' }, { source: other, prompt: 'Own' }] }] })}</script>`);
  writeFileSync(answer, JSON.stringify({ round: 1, answers: [{ item: 'DECIDE-2', option: 'review-round' }, { item: other, option: 'keep' }] })); const fix = box.commitFix('feedback fix\n');
  const review = run('prepare-review', { mode: 'feedback', place: 'feedback', start: late, change_dir: 'openspec/changes/demo', round: 2, answers_file: answer });
  expect([review.start, review.revisions]).toEqual([before, `${late}\n${fix}`]);
  expect(pendingReviewRound(artifacts)).toEqual(['DECIDE-2', late]); const later = join(artifacts, 'review-answers-round-2.json');
  writeFileSync(later, JSON.stringify({ round: 2, answers: [{ item: late, option: 'keep' }] })); expect(pendingReviewRound(artifacts)).toEqual([]); rmSync(later); markReviewRoundDone(artifacts);
  expect([pendingReviewRound(artifacts), reviewedCommits(artifacts)]).toEqual([[], [late]]);
});

test('late commits gain a review round option and yellow items that recommend work move to orange', () => {
  const ask = (...codes: string[]) => ({ prompt: codes.join(' '), options: codes.map(id => ({ id, label: id })) }); const { orange, yellow } = settleQuestions({ red: [], orange: [{ type: 'Late commit', questions: [ask('keep', 'fix')] }, { type: 'Late commit, Agent decision', questions: [ask('a', 'b', 'c', 'd'), ask('retest', 'leave')] }],
    yellow: [{ type: 'Risk', questions: [ask('accept', 'try')] }, { type: 'Risk', questions: [ask('fix', 'accept')] }] });
  const ids = (items: typeof orange) => items.map(item => item.questions?.map(question => question.options.map(option => option.id).join(' ')));
  expect([ids(orange), ids(yellow)]).toEqual([[['keep fix review-round'], ['a b c d', 'review-round keep', 'retest leave'], ['fix accept']], [['accept try']]]);
  const off = settleQuestions({ red: [], orange: [{ type: 'Late commit', questions: [ask('review-round', 'keep'), ask('a', 'review-round', 'b')] }], yellow: [{ type: 'Late commit', questions: [ask('accept', 'leave')] }] }, false);
  expect([ids(off.orange), ids(off.yellow)]).toEqual([[['keep leave', 'a b']], [['accept leave']]]);
});

test('unanswered red and orange questions count plain blanks and empty Other, with yellow optional', () => {
  expect(missingAnswers([{ required: true, option: '', other: '' }, { required: true, option: 'other', other: '  ' },
    { required: true, option: 'other', other: 'choice' }, { required: false, option: '', other: '' }])).toBe(2);
});

test('question defaults start blank for required tiers and restore saved answers', () => {
  for (const tier of ['red', 'orange']) expect(initialChoice(tier, 'recommended', false)).toBe('');
  expect(initialChoice('yellow', 'recommended', false)).toBe('recommended');
  expect(initialChoice('yellow', 'recommended', true)).toBe('');
  expect(initialChoice('red', 'recommended', true, 'other')).toBe('other');
});

test('collects choice values, notes and nonblank screenshot comments with the acceptance round', () => {
  const row = { item: 'CHECK-1', question: 1, option: 'other', other: 'Try again', note: 'More context' }; const options = [{ id: 'check', label: 'Check it', detail: 'Checked live' }]; const chosen = { ...row, option: 'check', label: 'Check it', detail: 'Checked live' };
  const input = { round: 2, head: 'reviewed', rows: [{ ...row, required: true, options }, { ...row, option: 'check', required: true, options }],
    screenshots: [{ file: 'one.png', round: 1 }, { file: 'two.png', round: 3 }],
    comments: new Map([['one.png', ''], ['two.png', 'Alignment']]) };
  expect(collectReview({ ...input, action: 'feedback' })).toEqual({
    action: 'feedback', round: 2, head: 'reviewed', answers: [row, chosen],
    screenshotComments: [{ file: 'two.png', round: 3, comment: 'Alignment' }], commandComments: [],
  });
  expect(collectReview({ ...input, action: 'merge' })).toEqual({ action: 'merge', round: 2, head: 'reviewed' });
  const summary = { item: 'note', question: 0, option: '', other: '', note: 'Sort the size table' };
  expect(collectReview({ ...input, action: 'feedback', note: 'Sort the size table' })).toMatchObject({ answers: [row, chosen, summary] });
  expect(collectReview({ ...input, action: 'feedback', note: '  ' })).toMatchObject({ answers: [row, chosen] });
});

test('change size totals combine both languages and all change columns', () => {
  expect(sizeTotals([{ files: 3, added: 5, modified: 3, removed: 2 }, { files: 1, added: 7, modified: 1, removed: 6 }]))
    .toEqual({ files: 4, added: 12, modified: 4, removed: 8 });
});

test('the reader check renders page items, flags unclear ones and rewrites only their wording', () => {
  const question = { prompt: 'Keep the floor?', source: 'DISPUTE-1', options: [{ id: 'keep', label: 'Keep', detail: 'As built' }, { id: 'follow-up', label: 'Follow-up', detail: '' }] };
  const item = { type: 'Dispute', title: 'Checker floor', detail: 'The floor is low.', source: ['DISPUTE-1'], links: [{ label: 'What was disputed', target: 'log:DISPUTE-1' }], questions: [question] };
  const ranking = { red: [], orange: [item], yellow: [{ ...item, type: 'Agent decision', title: 'Clear item', source: ['DECIDE-2'] }], evidence: '' };
  const page = readerItems(ranking);
  expect(page).toContain('## Item 1\n\n### Checker floor');
  expect(page).toContain('## Item 2\n\n### Clear item');
  expect(page).toContain('- Keep: As built\n- Follow-up\n\nLinks on GitHub: What was disputed');
  expect(page).not.toMatch(/DISPUTE-1|log:|Dispute|Agent decision/);
  const answer = { asks: 'Whether to keep it', options: [{ label: 'Keep', does: 'Keeps it' }, { label: 'Follow-up', does: 'Later' }], if_wrong: 'Bad things' };
  const flags = flagItems(ranking, { items: [{ number: 1, ...answer, options: [], if_wrong: ' ', unclear: ['floor'] }, { number: 2, ...answer, unclear: [] }, { number: 9, ...answer, unclear: ['x'] }] });
  expect(flags).toEqual([{ number: 1, title: 'Checker floor', unclear: ['floor'], missing: ['what each option would do', 'what happens if the choice is wrong'] }]);
  expect([flagItems(ranking, { items: [{ number: 1, ...answer, unclear: [] }] }).map(flag => flag.number), flagItems(ranking, {})]).toEqual([[2], []]);
  expect(readerNotes(flags)).toBe('Item 1: Checker floor\n- Could not understand: "floor"\n- Could not tell what each option would do\n- Could not tell what happens if the choice is wrong');
  const wording = { prompt: 'Keep the minimum?', options: [{ id: 'keep', label: 'Keep it', detail: 'Plain' }, { id: 'follow-up', label: 'Later', detail: 'After merge' }] };
  const next = applyRewrite(ranking, [{ number: 1, title: 'Plain title', detail: 'Plain detail', questions: [wording], links: ['Why it was argued'] }, { number: 2, title: 'Not flagged', detail: 'x', questions: [wording] }], [1]);
  expect(next.orange[0]).toEqual({ ...item, title: 'Plain title', detail: 'Plain detail', questions: [{ ...wording, source: 'DISPUTE-1' }], links: [{ label: 'Why it was argued', target: 'log:DISPUTE-1' }] });
  expect(applyRewrite(ranking, [{ number: 1, title: 'Plain title', detail: 'Plain detail', questions: [wording], links: ['a', 'b'] }], [1]).orange[0].links).toEqual(item.links);
  expect(next.yellow[0].title).toBe('Clear item');
  const reordered = { ...wording, options: [...wording.options].reverse() };
  expect(applyRewrite(ranking, [{ number: 1, title: 'Plain title', detail: 'Plain detail', questions: [reordered] }], [1]).orange[0]).toEqual(item);
  const both = [{ number: 1, title: 'Plain title', detail: 'Plain detail', questions: [wording] }, { number: 2, title: 'Breaks the check', detail: 'x', questions: [wording] }];
  const kept = passingRewrite(ranking, both, [1, 2], candidate => candidate.yellow[0].title !== 'Breaks the check');
  expect([kept.orange[0].title, kept.yellow[0].title, passingRewrite(ranking, both, [1, 2], () => false)]).toEqual(['Plain title', 'Clear item', ranking]);
  const edit = { ...item, questions: [{ ...question, options: [{ id: 'spec-edit', label: 'Apply', detail: 'Change X to Y.' }, question.options[1]] }] };
  const reworded = { prompt: 'P', options: [{ id: 'spec-edit', label: 'Apply it', detail: 'Reworded' }, { id: 'follow-up', label: 'Later', detail: '' }] };
  expect(applyRewrite({ ...ranking, orange: [edit] }, [{ number: 1, title: 'T', detail: 'D', questions: [reworded] }], [1]).orange[0].questions?.[0].options[0]).toEqual({ id: 'spec-edit', label: 'Apply it', detail: 'Change X to Y.' });
});
