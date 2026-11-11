import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';

import {
  FILES,
  checkGate,
  checkProgress,
  convergenceReasons,
  finalize,
  handoffProblems,
  lastLine,
  startRound,
} from '../.archon/workflows/codagent/.shared/lib/acceptance.ts';
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
  put(FILES.roundStatus, `READY ${head}\n`);
  put(FILES.testedRevision, `${head}\n`);
  put(FILES.explorationLog, 'explored\n');
  put(FILES.handoff, 'tester handoff\n');
  return head;
}

describe('convergence gate (acceptance-gate.sh action check)', () => {
  test('converges when the tester reports the current head ready, whatever is untracked', () => {
    converged();
    box.write('build-output.log', 'untracked files do not block\n');
    expect(convergenceReasons(box.exec, evidence)).toEqual([]);
    expect(checkGate(box.exec, evidence, false)).toEqual({ ready: true, fix: false, reasons: '' });
  });

  const failing: [string, () => void, string][] = [
    ['tester reported not ready', () => put(FILES.roundStatus, 'NOT_READY\n'), "round status is 'NOT_READY'"],
    ['tester recorded no status', () => remove(FILES.roundStatus), 'recorded no round status'],
    ['head moved after testing', () => void box.commitFix(), "not 'READY"],
    ['exploration log missing', () => remove(FILES.explorationLog), 'exploration-log.md is missing or empty'],
    [
      'tester did not record the tested revision',
      () => remove(FILES.testedRevision),
      "acceptance-tested-revision.txt names ''",
    ],
    [
      'tested revision is an earlier pass',
      () => put(FILES.testedRevision, '0123456789012345678901234567890123456789\n'),
      "acceptance-tested-revision.txt names '0123456789012345678901234567890123456789'",
    ],
    ['handoff missing', () => remove(FILES.handoff), 'acceptance-handoff.md is missing or empty'],
    ['tracked changes are uncommitted', () => box.write('file.txt', 'dirty\n'), 'tracked files have uncommitted changes'],
  ];
  test.each(failing)('does not converge when %s', (_name, mutate, want) => {
    converged();
    mutate();
    const reasons = convergenceReasons(box.exec, evidence);
    expect(reasons.join('\n')).toContain(want);
    const gate = checkGate(box.exec, evidence, false);
    expect(gate.ready).toBe(false);
    expect(gate.reasons).toContain(`- ${reasons[0]}`);
  });

  test('an empty handoff file does not count', () => {
    converged();
    put(FILES.handoff, '');
    expect(convergenceReasons(box.exec, evidence)).toContain('acceptance-handoff.md is missing or empty');
  });

  test('the gate asks for a fix unless it is the last round', () => {
    converged();
    put(FILES.roundStatus, 'NOT_READY\n');
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
    expect(read(FILES.preparationStatus)).toBe('ACCEPTANCE_COMPLETE\n');
    expect(read(FILES.handoff)).toBe('tester handoff\n');
  });

  test('records failure with a short handoff', () => {
    const head = converged();
    put(FILES.roundStatus, 'NOT_READY\n');
    expect(finalize(box.exec, evidence, '3').status).toBe('ACCEPTANCE_FAILED');
    expect(read(FILES.preparationStatus)).toBe('ACCEPTANCE_FAILED\n');
    expect(read(FILES.testerHandoff)).toBe('tester handoff\n');
    const handoff = read(FILES.handoff);
    for (const want of [
      'did not converge within 3 rounds',
      head,
      "round status is 'NOT_READY'",
      box.path('evidence/acceptance-findings.md'),
      box.path('evidence/acceptance-assumptions.md'),
      box.path('evidence/acceptance-handoff-tester.md'),
    ]) {
      expect(handoff).toContain(want);
    }
  });

  test('reruns keep the tester handoff', () => {
    converged();
    put(FILES.roundStatus, 'NOT_READY\n');
    for (let attempt = 0; attempt < 2; attempt++) {
      finalize(box.exec, evidence, '3');
      expect(read(FILES.preparationStatus)).toBe('ACCEPTANCE_FAILED\n');
      expect(read(FILES.testerHandoff)).toBe('tester handoff\n');
    }
    expect(read(FILES.handoff)).toContain('did not converge within 3 rounds');
  });

  test('writes a handoff when the tester wrote nothing', () => {
    // The evidence directory does not exist yet.
    finalize(box.exec, evidence, '3');
    expect(read(FILES.preparationStatus)).toBe('ACCEPTANCE_FAILED\n');
    expect(read(FILES.handoff)).not.toContain('acceptance-handoff-tester.md');
    expect(box.exists('evidence/acceptance-handoff-tester.md')).toBe(false);
  });
});

describe('startRound (reset-round-evidence)', () => {
  test('clears the previous round status and handoff and keeps the history', () => {
    converged();
    put(FILES.findings, 'defect\n');
    put(FILES.retestReason, 'repaired the test server\n');
    startRound(evidence, '0', 3);
    expect(box.exists(`evidence/${FILES.roundStatus}`)).toBe(false);
    expect(box.exists(`evidence/${FILES.handoff}`)).toBe(false);
    for (const kept of [FILES.explorationLog, FILES.testedRevision, FILES.findings, FILES.retestReason]) {
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
  const settle = (fix: boolean, stopUnchanged: boolean) => checkProgress(box.exec, evidence, fix, stopUnchanged);

  test('without a fix there is nothing to push', () => {
    expect(settle(false, true)).toEqual({ progressed: true, push: false });
  });

  test('an unchanged fix continues the rounds by default', () => {
    put(FILES.testedRevision, `${box.head()}\n`);
    expect(settle(true, false)).toEqual({ progressed: true, push: true });
  });

  test('an unchanged fix ends the rounds when stop_unchanged_acceptance is set', () => {
    put(FILES.testedRevision, `${box.head()}\n`);
    expect(settle(true, true)).toEqual({ progressed: false, push: false });
  });

  test('a committed fix continues the rounds', () => {
    put(FILES.testedRevision, `${box.head()}\n`);
    box.commitFix();
    expect(settle(true, true)).toEqual({ progressed: true, push: true });
  });

  test('a retest reason continues the rounds without a commit', () => {
    put(FILES.testedRevision, `${box.head()}\n`);
    put(FILES.retestReason, 'repaired the test server\n');
    expect(settle(true, true)).toEqual({ progressed: true, push: true });
  });

  test('an empty retest reason does not count', () => {
    put(FILES.testedRevision, `${box.head()}\n`);
    put(FILES.retestReason, '');
    expect(settle(true, true).progressed).toBe(false);
  });

  test('tracked changes left uncommitted count as progress', () => {
    put(FILES.testedRevision, `${box.head()}\n`);
    box.write('file.txt', 'dirty\n');
    expect(settle(true, true).progressed).toBe(true);
  });

  test('a missing tested revision counts as progress', () => {
    expect(settle(true, true).progressed).toBe(true);
  });

  test('a git failure is an error, not progress', () => {
    put(FILES.testedRevision, `${box.head()}\n`);
    const broken: typeof box.exec = (command, args, options) =>
      command === 'git' && args[0] === 'status' ? { status: 128, stdout: '', stderr: 'fatal\n' } : box.exec(command, args, options);
    expect(() => checkProgress(broken, evidence, true, true)).toThrow('could not inspect the worktree');
  });
});

describe('handoffProblems (verify-acceptance-handoff; failed testing is allowed for human review)', () => {
  test.each(['ACCEPTANCE_COMPLETE', 'ACCEPTANCE_FAILED'])('%s passes', status => {
    put(FILES.handoff, 'handoff\n');
    put(FILES.preparationStatus, `${status}\n`);
    expect(handoffProblems(evidence)).toEqual([]);
  });

  test('an invalid status fails', () => {
    put(FILES.handoff, 'handoff\n');
    put(FILES.preparationStatus, 'ACCEPTANCE_PENDING\n');
    expect(handoffProblems(evidence)).toEqual(['invalid acceptance preparation status: ACCEPTANCE_PENDING']);
  });

  test('a missing handoff and status fail both ways', () => {
    expect(handoffProblems(evidence)).toEqual([
      'acceptance handoff is missing or empty',
      'invalid acceptance preparation status: ',
    ]);
  });

  test('blank lines around the status are ignored', () => {
    put(FILES.handoff, 'handoff\n');
    put(FILES.preparationStatus, '\nACCEPTANCE_COMPLETE\n\n');
    expect(handoffProblems(evidence)).toEqual([]);
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
