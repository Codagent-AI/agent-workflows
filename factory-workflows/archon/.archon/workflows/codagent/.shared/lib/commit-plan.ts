// Commits an approved change definition so the checklist and implementation commits start
// from it. Port of Agent Runner's commit-change-plan.sh without its Agent Validator step.
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

export function commitChangePlan(exec: Exec, input: CommitPlanInput): CommitPlanResult {
  const { changeName, changeDir } = input;
  const nameProblems = changeNameProblems(changeName);
  if (nameProblems.length > 0) return outcome(fail(nameProblems.map(p => `commit-change-plan: ${p}`)));
  if (!isConfinedRelativePath(changeDir)) {
    return outcome(fail(`commit-change-plan: change_dir must be a confined relative path: ${changeDir}`));
  }

  if (existsSync('openspec') && lstatSync('openspec').isSymbolicLink() && changeDir.startsWith('openspec/')) {
    if (!existsSync(changeDir) || !statSync(changeDir).isDirectory()) {
      return outcome(fail(`commit-change-plan: change directory not found: ${changeDir}`));
    }
    return outcome(
      pass(),
      `openspec is a symbolic link; ${changeDir} is not committed here. Commit it by hand in the repository that holds the OpenSpec project.`
    );
  }

  const untracked = exec('git', ['ls-files', '--others', '--exclude-standard', '--', changeDir]);
  if (
    succeeded(exec, ['diff', '--cached', '--quiet', '--', changeDir]) &&
    succeeded(exec, ['diff', '--quiet', '--', changeDir]) &&
    untracked.status === 0 &&
    untracked.stdout.trim() === '' &&
    succeeded(exec, ['cat-file', '-e', `HEAD:${changeDir}`])
  ) {
    return outcome(pass(), `${changeName} is already committed`);
  }

  const paths = [changeDir];
  const add = exec('git', ['add', '-A', '--', changeDir]);
  if (add.status !== 0) return outcome(fail(['commit-change-plan: git add failed:', add.stderr.trim()]));
  if (changeDir === `openspec/changes/${changeName}`) {
    const config = exec('git', ['ls-files', '--others', '--exclude-standard', '--', 'openspec/config.yaml']);
    if (config.stdout.trim() === 'openspec/config.yaml') {
      if (!succeeded(exec, ['add', '--', 'openspec/config.yaml'])) {
        return outcome(fail('commit-change-plan: git add openspec/config.yaml failed'));
      }
      paths.push('openspec/config.yaml');
    }
  }
  if (succeeded(exec, ['diff', '--cached', '--quiet', '--', changeDir])) {
    return outcome(fail(`commit-change-plan: no staged changes found for ${changeName}`));
  }
  const commit = exec('git', ['commit', '-m', commitMessage(changeName), '--', ...paths]);
  if (commit.status !== 0) {
    return outcome(fail(['commit-change-plan: git commit failed:', commit.stdout.trim(), commit.stderr.trim()]));
  }
  return outcome(pass(), `committed ${changeDir}`);
}
