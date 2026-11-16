import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { checkCompletion, checkVerdict, type CompletionInput } from '../.archon/workflows/codagent/.shared/lib/completion.ts';
import { createSandbox, type Sandbox } from './helpers.ts';
let box: Sandbox; let input: CompletionInput;
const scripts = join(import.meta.dir, '../.archon/workflows/codagent/implement-change/scripts');
const plan = '| ID | Behavior | Spec reference | How to verify |\n|---|---|---|---|\n| I-1 | works | spec | unit |\n';
function checklist(status = 'verified', evidence = '`check.log`'): string {
  const tails = [' Code | Evidence | Status |', '---|---|---|', ` code | ${evidence} | ${status} |`];
  return `${plan.split('\n').filter(Boolean).map((line, i) => `${line}${tails[i]}`).join('\n')}\n`;
}
beforeEach(() => {
  box = createSandbox();
  input = { exec: box.exec, dir: box.path('artifacts'), changeDir: 'openspec/changes/demo', start: box.head(), blocked: false, judgment: '1' };
  box.write('artifacts/planned-checklist.md', plan);
  box.write('openspec/changes/demo/checklist.md', checklist());
  box.write('artifacts/evidence/check.log', 'passed');
  box.write('artifacts/implementation-complete.md', 'done; evidence/check.log');
  box.commitFix();
});
afterEach(() => box.dispose());
test('INT-007 completion scripts print schemas and save implementor output', () => {
  const env = { ...process.env, ARTIFACTS_DIR: input.dir, INPUTS_CHANGE_DIR: input.changeDir, INPUTS_START: JSON.stringify({ kind: 'git', commit: input.start }), INPUTS_BLOCKED: 'false', INPUTS_PREVIOUS: '' };
  const run = (name: string, extra = {}) => spawnSync(process.execPath, [join(scripts, `${name}.ts`)], { cwd: box.dir, env: { ...env, ...extra }, encoding: 'utf8' });
  const checked = run('check-completion'); expect(checked.status).toBe(0); expect(JSON.parse(checked.stdout)).toEqual({ complete: true, judge: false, iteration: 1, start: input.start });
  const verdict = run('check-completion-verdict', { INPUTS_ITERATION: '1', INPUTS_RESULT: '' });
  expect(verdict.status).toBe(0); expect(JSON.parse(verdict.stdout).done).toBe(true);
  expect(run('save-implementor-response', { INPUTS_RESULT: 'last implementor answer' }).status).toBe(0);
  expect(box.read('artifacts/implementor-response.md')).toBe('last implementor answer');
});
test.each(['record', 'evidence', 'commit', 'status'])('INT-007 missing completion condition %s reports the problem', condition => {
  if (condition === 'record') box.write('artifacts/implementation-complete.md', '');
  if (condition === 'evidence') box.write('artifacts/evidence/check.log', '');
  if (condition === 'commit') input.start = box.head();
  if (condition === 'status') box.write('openspec/changes/demo/checklist.md', checklist('failed', 'failed assertion'));
  expect(checkCompletion(input)).toEqual({ complete: false, judge: true });
  expect(box.read('artifacts/completion-problems.txt').trim()).not.toBe('');
});
test('INT-007 judge-only commits do not count', () => {
  input.start = box.head(); box.write('file.txt', 'record'); box.commit('[judge-completion] docs: record', 'file.txt');
  expect(checkCompletion(input).complete).toBe(false); expect(box.read('artifacts/completion-problems.txt')).toContain('no commit');
});
test.each(['failed', 'not verified'])('INT-007 complete rejects unsupported gaps %s', status => {
  box.write('openspec/changes/demo/checklist.md', checklist(status, status === 'failed' ? 'failure' : ''));
  checkCompletion(input);
  expect(() => checkVerdict(input, { verdict: 'complete', reason: 'done', remaining: '' })).toThrow('disagrees');
});
test('INT-007 complete accepts reasoned unverified gaps only when other prerequisites pass', () => {
  box.write('openspec/changes/demo/checklist.md', checklist('not verified', 'tool unavailable; decision D-01'));
  checkCompletion(input);
  expect(checkVerdict(input, { verdict: 'complete', reason: 'reasoned gap', remaining: '' }).done).toBe(true);
});
test.each(['unknown', '', 'continue', 'blocked'])('INT-007 invalid verdict %s fails', verdict => {
  box.write('artifacts/implementation-complete.md', ''); checkCompletion(input);
  expect(() => checkVerdict(input, { verdict, reason: 'reason', remaining: '' })).toThrow('no valid verdict');
});
test('INT-007 missing and malformed verdicts fail', () => {
  box.write('artifacts/implementation-complete.md', ''); checkCompletion(input);
  expect(() => checkVerdict(input, null)).toThrow('no valid verdict');
  expect(() => checkVerdict(input, {} as never)).toThrow('no valid verdict');
});
test('INT-007 persisted verdict is reused once and a fourth continue is refused', () => {
  box.write('artifacts/implementation-complete.md', ''); checkCompletion(input);
  const verdict = { verdict: 'continue', reason: 'work remains', remaining: 'implement the missing path' };
  for (let i = 1; i <= 3; i++) {
    input.judgment = String(i); expect(checkVerdict(input, verdict).verdict).toBe('continue');
    expect(checkVerdict(input, null).verdict).toBe('continue');
    expect(box.read('artifacts/completion-loop.jsonl').trim().split('\n')).toHaveLength(i);
    box.commitFix(`pass ${i}`); checkCompletion(input);
  }
  input.judgment = '4'; expect(() => checkVerdict(input, verdict)).toThrow('continue passes exhausted');
});
test('INT-007 third consecutive record fix fails and a continue resets its counter', () => {
  box.write('artifacts/implementation-complete.md', ''); checkCompletion(input);
  const verdict = { verdict: 'fix-record', reason: 'record missing', remaining: '' };
  checkVerdict(input, verdict); input.judgment = '2'; checkVerdict(input, verdict); input.judgment = '3';
  expect(() => checkVerdict(input, verdict)).toThrow('record could not be fixed');
  checkVerdict(input, { verdict: 'continue', reason: 'work', remaining: 'fix' }); input.judgment = '4';
  expect(checkVerdict(input, verdict).verdict).toBe('fix-record');
});
test('INT-007 a continue with neither commit nor changed row stalls; row changes are progress', () => {
  box.write('artifacts/implementation-complete.md', ''); checkCompletion(input);
  checkVerdict(input, { verdict: 'continue', reason: 'work', remaining: 'fix' });
  expect(() => checkCompletion(input)).toThrow('stalled');
  box.write('openspec/changes/demo/checklist.md', checklist('not verified', 'specific reason'));
  expect(checkCompletion(input).complete).toBe(false);
});
test.each(['returned', 'record', 'judge'])('INT-007 blocked %s stops and prints the decision', which => {
  if (which === 'returned') input.blocked = true;
  else box.write('artifacts/implementation-blocked.md', 'Question: choose the approved behavior.');
  if (which === 'judge') {
    box.write('artifacts/completion-check.json', JSON.stringify({ passed: false, only_unverified_with_reason: false }));
    expect(() => checkVerdict(input, { verdict: 'blocked', reason: 'decision', remaining: '' })).toThrow('choose the approved behavior');
  } else expect(() => checkCompletion(input)).toThrow('Update the definition and start a new run');
});

test('INT-007 replay after a continue commit keeps the original progress snapshot',()=>{
  box.write('artifacts/implementation-complete.md','');checkCompletion(input);
  checkVerdict(input,{verdict:'continue',reason:'work',remaining:'finish'});
  const original=box.read('artifacts/continue-snapshot.json');box.commitFix('continued');
  checkVerdict(input,null);expect(box.read('artifacts/continue-snapshot.json')).toBe(original);
  expect(checkCompletion(input).judge).toBe(false);
});
test('INT-007 malformed JSON and malformed remaining get the required verdict diagnostic',()=>{
  box.write('artifacts/implementation-complete.md','');checkCompletion(input);
  expect(()=>checkVerdict(input,{verdict:'continue',reason:'work',remaining:[]} as never)).toThrow('no valid verdict');
  const result=spawnSync(process.execPath,[join(scripts,'check-completion-verdict.ts')],{cwd:box.dir,encoding:'utf8',env:{...process.env,ARTIFACTS_DIR:input.dir,INPUTS_CHANGE_DIR:input.changeDir,INPUTS_START:JSON.stringify({kind:'git',commit:input.start}),INPUTS_ITERATION:'1',INPUTS_RESULT:'{bad'}});
  expect(result.status).toBe(1);expect(result.stderr).toContain('judge returned no valid verdict');
});
