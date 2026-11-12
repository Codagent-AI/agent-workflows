// Deterministic validation of an approved change definition.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { nonEmptyFile } from './artifacts.ts';
import { type CheckResult, fail, pass } from './check.ts';
import type { Exec } from './exec.ts';
import { changeNameProblems } from './params.ts';

export interface PlanningInput {
  changeName: string;
  changeDir: string;
  changeKind: string;
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

/** Sections that start at each match of `heading` and run to the next one. */
function sections(text: string, heading: RegExp): { title: string; body: string }[] {
  const matches = [...text.matchAll(heading)];
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    return { title: match[1], body: text.slice(start, end) };
  });
}

/** Problems with one scenario's WHEN and THEN behavior. */
function scenarioProblems(label: string, scenario: { title: string; body: string }): string[] {
  const scenarioLabel = `${label}, scenario '${scenario.title}'`;
  const problems: string[] = [];
  if (!/\*\*WHEN\*\*/.test(scenario.body)) problems.push(`${scenarioLabel} lacks WHEN behavior`);
  if (!/\*\*THEN\*\*/.test(scenario.body)) problems.push(`${scenarioLabel} lacks THEN behavior`);
  return problems;
}

/** Problems with one requirement's SHALL or MUST language and its scenarios. */
function requirementProblems(path: string, requirement: { title: string; body: string }): string[] {
  const label = `${path}: requirement '${requirement.title}'`;
  const problems: string[] = [];
  if (!/\b(?:SHALL|MUST)\b/.test(requirement.body)) problems.push(`${label} lacks SHALL or MUST language`);
  const scenarios = sections(requirement.body, /^#### Scenario:[ \t]*(.+?)[ \t]*$/gm);
  if (scenarios.length === 0) {
    problems.push(`${label} has no '#### Scenario:'`);
    return problems;
  }
  for (const scenario of scenarios) problems.push(...scenarioProblems(label, scenario));
  return problems;
}

function specDrivenProblems(paths: readonly string[]): string[] {
  const problems: string[] = [];
  for (const path of paths) {
    const requirements = sections(readFileSync(path, 'utf8'), /^### Requirement:[ \t]*(.+?)[ \t]*$/gm);
    if (requirements.length === 0) {
      problems.push(`${path} contains no '### Requirement:' heading`);
      continue;
    }
    for (const requirement of requirements) problems.push(...requirementProblems(path, requirement));
  }
  return problems;
}

/** Problems with the change name, kind and directory themselves. */
function identityProblems(input: PlanningInput): string[] {
  const nameProblems = changeNameProblems(input.changeName);
  if (nameProblems.length > 0) return nameProblems;
  if (input.changeKind !== 'openspec' && input.changeKind !== 'spec-driven') {
    return [`unsupported change_kind: ${input.changeKind}`];
  }
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
  if (input.changeKind === 'spec-driven') problems.push(...specDrivenProblems(specs));
  return problems;
}

/** Validates the definition; the problems include any `openspec validate` output. */
export function validatePlanningArtifacts(exec: Exec, input: PlanningInput): CheckResult {
  const prefix = (problem: string): string => `validate-planning-artifacts: ${problem}`;
  const inputFailures = identityProblems(input);
  if (inputFailures.length > 0) return fail(inputFailures.map(prefix));

  if (input.changeKind === 'openspec') {
    const result = exec('openspec', ['validate', '--type', 'change', input.changeName]);
    if (result.status !== 0) {
      return fail([result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n') || 'openspec validate failed');
    }
  }

  const problems = fileProblems(input);
  return problems.length === 0 ? pass() : fail(problems.map(prefix));
}
