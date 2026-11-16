// Deterministic validation of an approved change definition.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { nonEmptyFile } from './artifacts.ts';
import { type CheckResult, fail, pass } from './check.ts';
import type { Exec } from './exec.ts';
import { changeNameProblems } from './params.ts';

export interface PlanningInput {
  changeName: string;
  changeDir: string;
}

function sortedFiles(dir: string, pick: (name: string) => string | undefined): string[] {
  if (!(existsSync(dir) && statSync(dir).isDirectory())) return [];
  // As a shell glob, `*` skips hidden names.
  return readdirSync(dir)
    .filter(name => !name.startsWith('.'))
    .map(pick)
    .filter((path): path is string => path !== undefined)
    .sort();
}

/** `specs/*\/spec.md` under the change directory, sorted. */
function specPaths(changeDir: string): string[] {
  const specs = join(changeDir, 'specs');
  return sortedFiles(specs, name => join(specs, name, 'spec.md')).filter(nonEmptyFile);
}

/** Problems with the change name, kind and directory themselves. */
function identityProblems(input: PlanningInput): string[] {
  const nameProblems = changeNameProblems(input.changeName);
  if (nameProblems.length > 0) return nameProblems;
  if (input.changeDir === '') return ['change_dir must not be empty'];
  return [];
}

/** Problems with the files the definition must have, by kind. */
function fileProblems(input: PlanningInput): string[] {
  const problems: string[] = [];
  for (const required of ['proposal.md', 'design.md', 'test-plan.md']) {
    const path = join(input.changeDir, required);
    if (!nonEmptyFile(path)) problems.push(`missing or empty ${path}`);
  }
  const specs = specPaths(input.changeDir);
  if (specs.length === 0) problems.push(`no non-empty specification under ${input.changeDir}/specs/`);
  return problems;
}

/** Validates the definition; the problems include any `openspec validate` output. */
export function validatePlanningArtifacts(exec: Exec, input: PlanningInput): CheckResult {
  const prefix = (problem: string): string => `validate-planning-artifacts: ${problem}`;
  const inputFailures = identityProblems(input);
  if (inputFailures.length > 0) return fail(inputFailures.map(prefix));

  {
    const result = exec('openspec', ['validate', '--type', 'change', input.changeName]);
    if (result.status !== 0) {
      return fail([result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n') || 'openspec validate failed');
    }
  }

  const problems = fileProblems(input);
  return problems.length === 0 ? pass() : fail(problems.map(prefix));
}
