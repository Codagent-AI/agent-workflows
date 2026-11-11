// Deterministic validation of an approved change definition. Port of Agent Runner's
// validate-planning-artifacts.sh.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

import { type CheckResult, fail, pass } from './check.ts';
import type { Exec } from './exec.ts';
import { changeNameProblems } from './params.ts';

export interface PlanningInput {
  changeName: string;
  changeDir: string;
  changeKind: string;
  requireTasks: boolean;
}

const nonEmptyFile = (path: string): boolean => existsSync(path) && statSync(path).isFile() && statSync(path).size > 0;

function sortedFiles(dir: string, pick: (name: string) => string | undefined): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
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
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? text.length) : text.length;
    return { title: match[1], body: text.slice(start, end) };
  });
}

function specDrivenProblems(paths: readonly string[]): string[] {
  const problems: string[] = [];
  for (const path of paths) {
    const requirements = sections(readFileSync(path, 'utf8'), /^### Requirement:[ \t]*(.+?)[ \t]*$/gm);
    if (requirements.length === 0) {
      problems.push(`${path} contains no '### Requirement:' heading`);
      continue;
    }
    for (const requirement of requirements) {
      const label = `${path}: requirement '${requirement.title}'`;
      if (!/\b(?:SHALL|MUST)\b/.test(requirement.body)) problems.push(`${label} lacks SHALL or MUST language`);
      const scenarios = sections(requirement.body, /^#### Scenario:[ \t]*(.+?)[ \t]*$/gm);
      if (scenarios.length === 0) {
        problems.push(`${label} has no '#### Scenario:'`);
        continue;
      }
      for (const scenario of scenarios) {
        const scenarioLabel = `${label}, scenario '${scenario.title}'`;
        if (!/\*\*WHEN\*\*/.test(scenario.body)) problems.push(`${scenarioLabel} lacks WHEN behavior`);
        if (!/\*\*THEN\*\*/.test(scenario.body)) problems.push(`${scenarioLabel} lacks THEN behavior`);
      }
    }
  }
  return problems;
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function taskProblems(changeDir: string): string[] {
  const problems: string[] = [];
  const index = join(changeDir, 'tasks.md');
  if (!nonEmptyFile(index)) problems.push(`missing or empty ${index}`);
  const tasksDir = join(changeDir, 'tasks');
  const tasks = sortedFiles(tasksDir, name => (name.endsWith('.md') ? join(tasksDir, name) : undefined)).filter(
    nonEmptyFile
  );
  if (tasks.length === 0) {
    problems.push(`no non-empty task file under ${changeDir}/tasks/`);
  } else if (existsSync(index)) {
    const destinations = new Set<string>();
    for (const match of readFileSync(index, 'utf8').matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g)) {
      const destination = match[1].trim().replace(/^[<>]+|[<>]+$/g, '').split('#')[0].split('?')[0];
      destinations.add(posix.normalize(decodePath(destination)));
    }
    for (const task of tasks) {
      const relative = posix.join('tasks', task.slice(tasksDir.length + 1));
      if (!destinations.has(relative)) problems.push(`${index} does not link to ${relative}`);
    }
  }
  return problems;
}

/** Validates the definition; the problems include any `openspec validate` output. */
export function validatePlanningArtifacts(exec: Exec, input: PlanningInput): CheckResult {
  const prefix = (problem: string): string => `validate-planning-artifacts: ${problem}`;
  const nameProblems = changeNameProblems(input.changeName);
  if (nameProblems.length > 0) return fail(nameProblems.map(prefix));
  if (input.changeKind !== 'openspec' && input.changeKind !== 'spec-driven') {
    return fail(prefix(`unsupported change_kind: ${input.changeKind}`));
  }
  if (input.changeDir === '') return fail(prefix('change_dir must not be empty'));
  const expectedDir = `openspec/changes/${input.changeName}`;
  if (input.changeKind === 'openspec' && input.changeDir !== expectedDir) {
    return fail(prefix(`change_dir must be ${expectedDir} for ${input.changeKind}: ${input.changeDir}`));
  }

  if (input.changeKind === 'openspec') {
    const result = exec('openspec', ['validate', '--type', 'change', input.changeName]);
    if (result.status !== 0) {
      return fail([result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n') || 'openspec validate failed');
    }
  }

  const problems: string[] = [];
  for (const required of ['proposal.md', 'design.md', 'test-plan.md']) {
    const path = join(input.changeDir, required);
    if (!nonEmptyFile(path)) problems.push(`missing or empty ${path}`);
  }
  const specs = specPaths(input.changeDir);
  if (specs.length === 0) problems.push(`no non-empty specification under ${input.changeDir}/specs/`);
  if (input.changeKind === 'spec-driven') problems.push(...specDrivenProblems(specs));
  if (input.requireTasks) problems.push(...taskProblems(input.changeDir));
  return problems.length === 0 ? pass() : fail(problems.map(prefix));
}
