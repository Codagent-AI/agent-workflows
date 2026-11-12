// Commits an approved change definition so the checklist and implementation commits start
// from it.
import { existsSync, lstatSync, statSync } from 'node:fs';

import { type CheckResult, fail, pass } from './check.ts';
import type { Exec } from './exec.ts';
import { changeNameProblems } from './params.ts';

export interface CommitPlanInput {
  changeName: string;
  changeDir: string;
}

export interface CommitPlanResult extends CheckResult {
  /** What happened, for the node's output. */
  message: string;
}

const outcome = (result: CheckResult, message = ''): CommitPlanResult => ({ ...result, message });

/** A relative path with no empty, `.` or `..` segment. */
export function isConfinedRelativePath(path: string): boolean {
  if (path === '' || path.startsWith('/')) return false;
  return path.split('/').every(segment => segment !== '.' && segment !== '..');
}

/** `[commit-plan] chore: ...`, or `ABC-123: Add change plan` for a ticket-named change. */
export function commitMessage(changeName: string): string {
  const [prefix, number, ...rest] = changeName.split('-');
  if (prefix && number && /^[0-9]+$/.test(number) && rest.length > 0) {
    return `${prefix.toUpperCase()}-${number}: Add change plan`;
  }
  return `[commit-plan] chore: add change documents for ${changeName}`;
}

const succeeded = (exec: Exec, args: readonly string[]): boolean => exec('git', args).status === 0;

/** A problem with the change name or directory, if any. */
function inputProblem(input: CommitPlanInput): CommitPlanResult | undefined {
  const nameProblems = changeNameProblems(input.changeName);
  if (nameProblems.length > 0) return outcome(fail(nameProblems.map(p => `commit-change-plan: ${p}`)));
  if (!isConfinedRelativePath(input.changeDir)) {
    return outcome(fail(`commit-change-plan: change_dir must be a confined relative path: ${input.changeDir}`));
  }
  return undefined;
}

/** The result for a change inside a symlinked openspec directory, which is not committed here. */
function symlinkedOpenspec(changeDir: string): CommitPlanResult | undefined {
  if (!(existsSync('openspec') && lstatSync('openspec').isSymbolicLink() && changeDir.startsWith('openspec/'))) {
    return undefined;
  }
  if (!(existsSync(changeDir) && statSync(changeDir).isDirectory())) {
    return outcome(fail(`commit-change-plan: change directory not found: ${changeDir}`));
  }
  return outcome(
    pass(),
    `openspec is a symbolic link; ${changeDir} is not committed here. Commit it by hand in the repository that holds the OpenSpec project.`
  );
}

/** Whether the change directory has no staged, unstaged or untracked changes and is in HEAD. */
function alreadyCommitted(exec: Exec, changeDir: string): boolean {
  const untracked = exec('git', ['ls-files', '--others', '--exclude-standard', '--', changeDir]);
  return (
    succeeded(exec, ['diff', '--cached', '--quiet', '--', changeDir]) &&
    succeeded(exec, ['diff', '--quiet', '--', changeDir]) &&
    untracked.status === 0 &&
    untracked.stdout.trim() === '' &&
    succeeded(exec, ['cat-file', '-e', `HEAD:${changeDir}`])
  );
}

/** Stages a new openspec/config.yaml with its change; returns a failure, or undefined. */
function stageNewConfig(exec: Exec, paths: string[]): CommitPlanResult | undefined {
  const config = exec('git', ['ls-files', '--others', '--exclude-standard', '--', 'openspec/config.yaml']);
  if (config.stdout.trim() !== 'openspec/config.yaml') return undefined;
  if (!succeeded(exec, ['add', '--', 'openspec/config.yaml'])) {
    return outcome(fail('commit-change-plan: git add openspec/config.yaml failed'));
  }
  paths.push('openspec/config.yaml');
  return undefined;
}

/** Stages the change; returns the paths to commit, or a failure. */
function stageChange(exec: Exec, input: CommitPlanInput): string[] | CommitPlanResult {
  const paths = [input.changeDir];
  const add = exec('git', ['add', '-A', '--', input.changeDir]);
  if (add.status !== 0) return outcome(fail(['commit-change-plan: git add failed:', add.stderr.trim()]));
  if (input.changeDir === `openspec/changes/${input.changeName}`) {
    const failed = stageNewConfig(exec, paths);
    if (failed) return failed;
  }
  return paths;
}

export function commitChangePlan(exec: Exec, input: CommitPlanInput): CommitPlanResult {
  const { changeName, changeDir } = input;
  const early = inputProblem(input) ?? symlinkedOpenspec(changeDir);
  if (early) return early;
  if (alreadyCommitted(exec, changeDir)) return outcome(pass(), `${changeName} is already committed`);

  const paths = stageChange(exec, input);
  if (!Array.isArray(paths)) return paths;
  if (succeeded(exec, ['diff', '--cached', '--quiet', '--', changeDir])) {
    return outcome(fail(`commit-change-plan: no staged changes found for ${changeName}`));
  }
  const commit = exec('git', ['commit', '-m', commitMessage(changeName), '--', ...paths]);
  if (commit.status !== 0) {
    return outcome(fail(['commit-change-plan: git commit failed:', commit.stdout.trim(), commit.stderr.trim()]));
  }
  return outcome(pass(), `committed ${changeDir}`);
}
