import { endAcceptance, pushRecheck, unverifiedRows } from '../.archon/workflows/codagent/.shared/lib/finish-run.ts';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { rmSync, symlinkSync } from 'node:fs';

import {
  checkGate,
  checkProgress,
  clearRetestReason,
  convergenceReasons,
  finalize,
  lastLine,
  startRound,
} from '../.archon/workflows/codagent/.shared/lib/acceptance.ts';
import { ARTIFACTS } from '../.archon/workflows/codagent/.shared/lib/artifacts.ts';
import { type Sandbox, createSandbox } from './helpers.ts';

let box: Sandbox;
let evidence: string;
beforeEach(() => {
  box = createSandbox();
  evidence = box.path('evidence');
});
afterEach(() => box.dispose());

const put = (name: string, content: string): void => box.write(`evidence/${name}`, content);
const read = (name: string): string => box.read(`evidence/${name}`);
const remove = (name: string): void => rmSync(box.path(`evidence/${name}`));

/** Evidence of a tester who reported the current head ready. */
function converged(): string {
  const head = box.head();
  put(ARTIFACTS.roundStatus, `READY ${head}\n`);
  put(ARTIFACTS.testedRevision, `${head}\n`);
  put(ARTIFACTS.explorationLog, 'explored\n');
  put(ARTIFACTS.handoff, 'tester handoff\n');
  return head;
}

describe('convergence gate (acceptance-gate.sh action check)', () => {
  test('converges when the tester reports the current head ready, whatever is untracked', () => {
    converged();
    box.write('build-output.log', 'untracked files do not block\n');
    expect(convergenceReasons(box.exec, evidence)).toEqual([]);
    expect(checkGate(box.exec, evidence, false)).toEqual({ ready: true, fix: false, reasons: '' });
  });

  const failing: [string, () => void, string | undefined][] = [
    ['tester reported not ready', () => put(ARTIFACTS.roundStatus, 'NOT_READY\n'), 'NOT_READY'],
    ['tester recorded no status', () => remove(ARTIFACTS.roundStatus), ARTIFACTS.roundStatus],
    ['head moved after testing', () => void box.commitFix(), undefined],
    ['exploration log missing', () => remove(ARTIFACTS.explorationLog), ARTIFACTS.explorationLog],
    [
      'tester did not record the tested revision',
      () => remove(ARTIFACTS.testedRevision),
      ARTIFACTS.testedRevision,
    ],
    [
      'tested revision is an earlier pass',
      () => put(ARTIFACTS.testedRevision, '0123456789012345678901234567890123456789\n'),
      '0123456789012345678901234567890123456789',
    ],
    ['handoff missing', () => remove(ARTIFACTS.handoff), ARTIFACTS.handoff],
    ['tracked changes are uncommitted', () => box.write('file.txt', 'dirty\n'), undefined],
  ];
  test.each(failing)('does not converge when %s', (_name, mutate, want) => {
    converged();
    mutate();
    const reasons = convergenceReasons(box.exec, evidence);
    expect(reasons.length).toBeGreaterThan(0);
    if (want !== undefined) expect(reasons.join('\n')).toContain(want);
    const gate = checkGate(box.exec, evidence, false);
    expect(gate.ready).toBe(false);
    expect(gate.reasons).toContain(reasons[0]);
  });

  test('an empty handoff file does not count', () => {
    converged();
    put(ARTIFACTS.handoff, '');
    expect(convergenceReasons(box.exec, evidence).join('\n')).toContain(ARTIFACTS.handoff);
  });

  test('the gate asks for a fix unless it is the last round', () => {
    converged();
    put(ARTIFACTS.roundStatus, 'NOT_READY\n');
    expect(checkGate(box.exec, evidence, false)).toMatchObject({ ready: false, fix: true });
    expect(checkGate(box.exec, evidence, true)).toMatchObject({ ready: false, fix: false });
  });
});

describe('finalize (acceptance-gate.sh action finalize)', () => {
  test('records completion and keeps the tester handoff', () => {
    const head = converged();
    const result = finalize(box.exec, evidence, '3');
    expect(result.status).toBe('ACCEPTANCE_COMPLETE');
    expect(result.message).toContain(head);
    expect(read(ARTIFACTS.preparationStatus)).toBe('ACCEPTANCE_COMPLETE\n');
    expect(read(ARTIFACTS.handoff)).toBe('tester handoff\n');
  });

  test('records failure with a short handoff', () => {
    const head = converged();
    put(ARTIFACTS.roundStatus, 'NOT_READY\n');
    expect(finalize(box.exec, evidence, '3').status).toBe('ACCEPTANCE_FAILED');
    expect(read(ARTIFACTS.preparationStatus)).toBe('ACCEPTANCE_FAILED\n');
    expect(read(ARTIFACTS.testerHandoff)).toBe('tester handoff\n');
    const handoff = read(ARTIFACTS.handoff);
    for (const want of [
      head,
      'NOT_READY',
      box.path('evidence/acceptance-findings.md'),
      box.path('evidence/decision-log.md'),
      box.path('evidence/acceptance-handoff-tester.md'),
    ]) {
      expect(handoff).toContain(want);
    }
  });

  test('reruns keep the tester handoff', () => {
    converged();
    put(ARTIFACTS.roundStatus, 'NOT_READY\n');
    for (let attempt = 0; attempt < 2; attempt++) {
      finalize(box.exec, evidence, '3');
      expect(read(ARTIFACTS.preparationStatus)).toBe('ACCEPTANCE_FAILED\n');
      expect(read(ARTIFACTS.testerHandoff)).toBe('tester handoff\n');
    }
  });

  test('reports whether acceptance converged', () => {
    converged();
    expect(finalize(box.exec, evidence, '3').ready).toBe(true);
    put(ARTIFACTS.roundStatus, 'NOT_READY\n');
    expect(finalize(box.exec, evidence, '3').ready).toBe(false);
  });

  test('fails when what it wrote cannot be read back', () => {
    converged();
    // A write to /dev/null succeeds and leaves nothing to read.
    symlinkSync('/dev/null', box.path(`evidence/${ARTIFACTS.preparationStatus}`));
    expect(() => finalize(box.exec, evidence, '3')).toThrow();
  });

  test('writes a handoff when the tester wrote nothing', () => {
    // The evidence directory does not exist yet.
    finalize(box.exec, evidence, '3');
    expect(read(ARTIFACTS.preparationStatus)).toBe('ACCEPTANCE_FAILED\n');
    expect(read(ARTIFACTS.handoff)).not.toContain('acceptance-handoff-tester.md');
    expect(box.exists('evidence/acceptance-handoff-tester.md')).toBe(false);
  });
});

describe('startRound (reset-round-evidence)', () => {
  test('clears the previous round status and handoff and keeps the history', () => {
    converged();
    put(ARTIFACTS.findings, 'defect\n');
    put(ARTIFACTS.retestReason, 'repaired the test server\n');
    startRound(evidence, '0', 3);
    expect(box.exists(`evidence/${ARTIFACTS.roundStatus}`)).toBe(false);
    expect(box.exists(`evidence/${ARTIFACTS.handoff}`)).toBe(false);
    for (const kept of [ARTIFACTS.explorationLog, ARTIFACTS.testedRevision, ARTIFACTS.findings, ARTIFACTS.retestReason]) {
      expect(box.exists(`evidence/${kept}`)).toBe(true);
    }
  });

  test('is safe when there is nothing to clear', () => {
    expect(startRound(evidence, '', 3)).toEqual({ round: 0, last: false });
  });

  test.each([
    ['', 3, 0, false],
    ['0', 3, 1, false],
    ['1', 3, 2, true],
    ['', 1, 0, true],
    ['0', 2, 1, true],
    ['$LOOP_PREV.reset-round-evidence.output.round', 3, 0, false],
    ['null', 1, 0, true],
  ])('previous round %p of %d rounds -> round %d, last %p', (previous, rounds, round, last) => {
    expect(startRound(evidence, previous, rounds)).toEqual({ round, last });
  });
});

describe('checkProgress (check-acceptance-progress)', () => {
  const settle = (fix: boolean) => checkProgress(box.exec, evidence, fix);

  test('without a fix there is nothing to push', () => {
    expect(settle(false)).toEqual({ progressed: true, push: false });
  });

  test('an unchanged fix ends the rounds unconditionally', () => {
    put(ARTIFACTS.testedRevision, `${box.head()}\n`);
    expect(settle(true)).toEqual({ progressed: false, push: false });
  });

  test('a committed fix continues the rounds', () => {
    put(ARTIFACTS.testedRevision, `${box.head()}\n`);
    box.commitFix();
    expect(settle(true)).toEqual({ progressed: true, push: true });
  });

  test('a retest reason continues the rounds without a commit', () => {
    put(ARTIFACTS.testedRevision, `${box.head()}\n`);
    put(ARTIFACTS.retestReason, 'repaired the test server\n');
    expect(settle(true)).toEqual({ progressed: true, push: true });
  });

  test('an empty retest reason does not count', () => {
    put(ARTIFACTS.testedRevision, `${box.head()}\n`);
    put(ARTIFACTS.retestReason, '');
    expect(settle(true).progressed).toBe(false);
  });

  test('tracked changes left uncommitted count as progress', () => {
    put(ARTIFACTS.testedRevision, `${box.head()}\n`);
    box.write('file.txt', 'dirty\n');
    expect(settle(true).progressed).toBe(true);
  });

  test('a missing tested revision counts as progress', () => {
    expect(settle(true).progressed).toBe(true);
  });

  test('a git failure is an error, not progress', () => {
    put(ARTIFACTS.testedRevision, `${box.head()}\n`);
    const broken: typeof box.exec = (command, args, options) =>
      command === 'git' && args[0] === 'status' ? { status: 128, stdout: '', stderr: 'fatal\n' } : box.exec(command, args, options);
    expect(() => checkProgress(broken, evidence, true)).toThrow();
  });
});

describe('lastLine', () => {
  test('returns the last non-blank line without trailing whitespace', () => {
    put('f.txt', 'one\ntwo  \n\n  \n');
    expect(lastLine(box.path('evidence/f.txt'))).toBe('two');
  });

  test('is empty for a missing file', () => {
    expect(lastLine(box.path('evidence/none.txt'))).toBe('');
  });
});


describe('clearRetestReason', () => {
  test('clears the stale reason before a fix and tolerates absent files', () => {
    clearRetestReason(evidence);
    put(ARTIFACTS.retestReason, 'previous round reason');
    clearRetestReason(evidence);
    expect(box.exists(`evidence/${ARTIFACTS.retestReason}`)).toBe(false);
    clearRetestReason(evidence);
  });
});

test('blocked acceptance records failure and a persistent stop marker for the loop',()=>{
  const dir=box.path('evidence');endAcceptance(dir,'blocked on decision D-01');
  expect(box.read('evidence/acceptance-stop.txt')).toContain('D-01');
  const recorded=JSON.parse(box.read('evidence/step-results.json'));
  expect(recorded.acceptance.ok).toBe(false);expect(recorded.acceptance.problems).toContain('D-01');
});

test('the recheck lists only the rows still not verified',()=>{
  box.write('change/checklist.md','| ID | Behavior | Evidence | Status |\n| --- | --- | --- | --- |\n| I-1 | a | `a.log` | verified |\n| I-2 | b | unit only | not verified |\n| I-3 | c | `c.log` | failed |\n| I-4 | d | stale | `not verified` |\n');
  expect(unverifiedRows(box.path('change'))).toEqual({rows:'I-2, I-4'});
  expect(unverifiedRows(box.path('missing'))).toEqual({rows:''});
});
test('a recheck push that fails is recorded as an acceptance failure',()=>{
  box.commitFix();const dir=box.path('evidence');
  expect(pushRecheck(dir).ok).toBe(false);
  const recorded=JSON.parse(box.read('evidence/step-results.json'));
  expect(recorded.acceptance.ok).toBe(false);expect(recorded.acceptance.problems).not.toBe('');
});
test('a recheck push reaches the remote branch',()=>{
  const bare=box.addBareOrigin();box.git('push','-q','--set-upstream','origin','HEAD');const head=box.commitFix();
  expect(pushRecheck(box.path('evidence')).ok).toBe(true);
  expect(box.gitIn(box.dir,'--git-dir',bare,'rev-parse',`refs/heads/${box.git('branch','--show-current')}`)).toBe(head);
});
