// The acceptance rounds' evidence files and convergence gate.
//
// Convergence requires all of:
//   - the tester's acceptance-round-status.txt ends with `READY <HEAD>`, where <HEAD> is
//     the full SHA of local HEAD;
//   - acceptance-tested-revision.txt names <HEAD>, the revision the tester last explored;
//   - exploration-log.md and acceptance-handoff.md exist and are non-empty;
//   - no tracked file has uncommitted changes.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ARTIFACTS, nonEmptyFile } from './artifacts.ts';
import type { Exec } from './exec.ts';
import { head, status } from './worktree.ts';


/** The last non-blank line of a file, without trailing whitespace, or '' if none. */
export function lastLine(path: string): string {
  if (!existsSync(path)) return '';
  const lines = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter(line => line.trim() !== '');
  return (lines.at(-1) ?? '').trimEnd();
}

/** Why acceptance has not converged at the current HEAD; empty when it has. */
export function convergenceReasons(exec: Exec, evidenceDir: string): string[] {
  const current = head(exec);
  if (!current) return ['local HEAD could not be resolved'];
  const reasons: string[] = [];
  const roundStatus = lastLine(join(evidenceDir, ARTIFACTS.roundStatus));
  if (roundStatus === '') {
    reasons.push(`the tester recorded no round status in ${ARTIFACTS.roundStatus}`);
  } else if (roundStatus !== `READY ${current}`) {
    reasons.push(`the tester's round status is '${roundStatus}', not 'READY ${current}'`);
  }
  const tested = lastLine(join(evidenceDir, ARTIFACTS.testedRevision));
  if (tested !== current) reasons.push(`${ARTIFACTS.testedRevision} names '${tested}', not '${current}'`);
  for (const name of [ARTIFACTS.explorationLog, ARTIFACTS.handoff]) {
    if (!nonEmptyFile(join(evidenceDir, name))) reasons.push(`${name} is missing or empty`);
  }
  const changes = status(exec, ['--untracked-files=no']);
  if (changes === undefined) reasons.push('could not inspect tracked changes');
  else if (changes !== '') reasons.push('tracked files have uncommitted changes');
  return reasons;
}

export interface Round {
  /** Zero-based round index. */
  round: number;
  /** Whether this is the last round allowed. */
  last: boolean;
}

/**
 * Starts a round: the gate must judge only evidence written in this round, so the previous
 * round's status and handoff are cleared. exploration-log.md, acceptance-tested-revision.txt
 * and acceptance-findings.md remain as the tester's history and diff base, and
 * acceptance-retest-reason.txt remains for this round's tester.
 */
export function startRound(evidenceDir: string, previousRound: string, rounds: number): Round {
  rmSync(join(evidenceDir, ARTIFACTS.roundStatus), { force: true });
  rmSync(join(evidenceDir, ARTIFACTS.handoff), { force: true });
  // The first iteration has no previous output; anything that is not a round number means none.
  const previous = previousRound.trim();
  const round = /^[0-9]+$/.test(previous) ? Number(previous) + 1 : 0;
  return { round, last: round + 1 >= rounds };
}

export interface Gate {
  ready: boolean;
  /** Whether the lead fixes the findings now: not ready, and not the last round. */
  fix: boolean;
  reasons: string;
}

export function checkGate(exec: Exec, evidenceDir: string, last: boolean): Gate {
  const reasons = convergenceReasons(exec, evidenceDir);
  const ready = reasons.length === 0;
  return { ready, fix: !(ready || last), reasons: reasons.map(reason => `- ${reason}`).join('\n') };
}

export interface Progress {
  progressed: boolean;
  /** Whether the round pushes the fix and the next round retests it. */
  push: boolean;
}

/**
 * After the lead's fix: did it move the tested revision, leave tracked changes, or write a
 * retest reason? With stop_unchanged_acceptance, a fix that did none of these ends the
 * rounds, because another tester round could only repeat the last one.
 */
export function checkProgress(exec: Exec, evidenceDir: string, fix: boolean, stopUnchanged: boolean): Progress {
  if (!fix) return { progressed: true, push: false };
  if (!stopUnchanged) return { progressed: true, push: true };
  const tested = lastLine(join(evidenceDir, ARTIFACTS.testedRevision)).replace(/\s/g, '');
  const current = head(exec);
  const changes = status(exec, ['--untracked-files=no']);
  // A git failure must not read as progress, or the stop option would push and retest.
  if (current === undefined || changes === undefined) {
    throw new Error('could not inspect the worktree to decide whether the acceptance fix made progress');
  }
  const progressed =
    current !== tested || changes !== '' || nonEmptyFile(join(evidenceDir, ARTIFACTS.retestReason));
  return { progressed, push: progressed };
}

export const GENERATED_HEADING = '# Acceptance did not converge within';

export interface Finalized {
  /** Whether acceptance converged: the run's verdict. */
  ready: boolean;
  status: 'ACCEPTANCE_COMPLETE' | 'ACCEPTANCE_FAILED';
  message: string;
}

/** Reads the two files back, so a write that did not land fails the step that made it. */
function readBack(evidenceDir: string, expected: Finalized['status']): void {
  const problems: string[] = [];
  if (!nonEmptyFile(join(evidenceDir, ARTIFACTS.handoff))) problems.push('acceptance handoff is missing or empty');
  const written = lastLine(join(evidenceDir, ARTIFACTS.preparationStatus));
  if (written !== expected) problems.push(`acceptance preparation status is '${written}', not '${expected}'`);
  if (problems.length > 0) throw new Error(problems.join('\n'));
}

/**
 * Writes acceptance-preparation-status.txt. On failure it also writes a short
 * acceptance-handoff.md, keeping any tester-written handoff as acceptance-handoff-tester.md.
 * Reads both files back and throws when either is wrong. Safe to rerun.
 */
export function finalize(exec: Exec, evidenceDir: string, rounds: string): Finalized {
  const reasons = convergenceReasons(exec, evidenceDir);
  const current = head(exec);
  mkdirSync(evidenceDir, { recursive: true });
  const statusFile = join(evidenceDir, ARTIFACTS.preparationStatus);
  if (reasons.length === 0) {
    writeFileSync(statusFile, 'ACCEPTANCE_COMPLETE\n');
    readBack(evidenceDir, 'ACCEPTANCE_COMPLETE');
    return {
      ready: true,
      status: 'ACCEPTANCE_COMPLETE',
      message: `acceptance preparation complete at ${current ?? ''}`,
    };
  }
  const handoff = join(evidenceDir, ARTIFACTS.handoff);
  const testerHandoff = join(evidenceDir, ARTIFACTS.testerHandoff);
  // A rerun must not move its own earlier handoff over the tester's, so only a handoff
  // without the generated heading is kept as the tester's.
  if (nonEmptyFile(handoff) && !(readFileSync(handoff, 'utf8').split('\n')[0] ?? '').startsWith(GENERATED_HEADING)) {
    renameSync(handoff, testerHandoff);
  }
  const reasonLines = reasons.map(reason => `- ${reason}\n`).join('');
  const lines = [
    `${GENERATED_HEADING} ${rounds || 'the allowed'} rounds\n`,
    `Local HEAD: ${current ?? 'unknown'}\n`,
    `Reasons:\n\n${reasonLines}`,
    `Open findings: ${join(evidenceDir, ARTIFACTS.findings)}`,
    `Unresolved assumptions: ${join(evidenceDir, ARTIFACTS.assumptions)}`,
  ];
  if (nonEmptyFile(testerHandoff)) lines.push(`Tester handoff: ${testerHandoff}`);
  writeFileSync(handoff, `${lines.join('\n')}\n`);
  writeFileSync(statusFile, 'ACCEPTANCE_FAILED\n');
  readBack(evidenceDir, 'ACCEPTANCE_FAILED');
  return {
    ready: false,
    status: 'ACCEPTANCE_FAILED',
    message: `acceptance preparation failed; wrote ${handoff}\n${reasonLines}`,
  };
}
