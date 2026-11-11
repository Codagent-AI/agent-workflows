// Checks on the git worktree and the blocked record.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type CheckResult, fail, pass } from './check.ts';
import { type Exec, output } from './exec.ts';

/** The record an agent writes when only the user can settle a question about the definition. */
export const BLOCKED_RECORD = 'implementation-blocked.md';

export function checkNotBlocked(artifactsDir: string): CheckResult {
  const record = join(artifactsDir, BLOCKED_RECORD);
  if (!existsSync(record)) return pass();
  return fail([
    'the change cannot be implemented compliantly without a user decision:',
    readFileSync(record, 'utf8').trimEnd(),
    'after deciding, update the definition and start a new run; resuming this run would not redo the stopped work',
  ]);
}

export function head(exec: Exec): string | undefined {
  return output(exec, 'git', ['rev-parse', '--verify', 'HEAD']);
}

/** `git status --porcelain` lines, or undefined when git fails. */
export function status(exec: Exec, args: readonly string[] = []): string | undefined {
  const result = exec('git', ['status', '--porcelain', ...args]);
  return result.status === 0 ? result.stdout.replace(/\n+$/, '') : undefined;
}

/** No tracked file has uncommitted changes. */
export function checkTrackedClean(exec: Exec, problem: string): CheckResult {
  const changes = status(exec, ['--untracked-files=no']);
  if (changes === undefined) return fail('could not inspect tracked changes');
  return changes === '' ? pass() : fail([problem, changes]);
}

/** No tracked or untracked file has uncommitted changes. */
export function checkWorktreeClean(exec: Exec, problem: string): CheckResult {
  const changes = status(exec);
  if (changes === undefined) return fail('could not inspect the worktree');
  return changes === '' ? pass() : fail([problem, changes]);
}

export function checkCommitsSince(exec: Exec, startHead: string): CheckResult {
  const count = output(exec, 'git', ['rev-list', '--count', `${startHead}..HEAD`]);
  if (count === undefined) return fail(`could not count commits since ${startHead}`);
  return Number(count) > 0
    ? pass()
    : fail(`no commits since ${startHead}; the change was not implemented`);
}
