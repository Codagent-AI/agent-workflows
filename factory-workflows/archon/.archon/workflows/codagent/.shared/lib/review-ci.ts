import { posix } from 'node:path';
import type { CiResult } from './ci.ts';
import { type Exec, output } from './exec.ts';

interface Step { run?: string; 'working-directory'?: string; if?: unknown; 'continue-on-error'?: unknown }
interface Defaults { run?: { 'working-directory'?: string } }
interface Job { name?: string; defaults?: Defaults; steps?: Step[] }
interface Workflow { defaults?: Defaults; jobs?: Record<string, Job> }

function isTestPath(path: string): boolean {
  return /(?:^|\/)(?:tests?|__tests__)\//i.test(path) || /(?:^|\/)(?:test[_-]|spec[_-])|[._-](?:test|spec)\.[\w]+$/i.test(path);
}

function testCommands(run: string): string[][] {
  return run.split(/\r?\n|&&/).flatMap(line => {
    const match = /^\s*(?:bun test|node --test|(?:python(?:3)? -m )?pytest|vitest(?: run)?|jest|go test)(?:\s+(.*))?$/.exec(line);
    if (!match) return [];
    return [(match[1] ?? '').split(/\s+/).filter(Boolean)];
  });
}

function testPaths(exec: Exec, directory: string, command: string): string[] {
  return testCommands(command).flatMap(args => {
    if (args.length === 0) return [directory];
    if (args.some(arg => !/^[\w./-]+$/.test(arg) || arg.startsWith('-'))) return [];
    return args.map(arg => posix.join(directory, arg.replace(/\/\.\.\.$/, '').replace(/\/$/, '')));
  }).filter(path => path === '.' || output(exec, 'git', ['cat-file', '-t', `HEAD:${path}`]) !== undefined);
}

function stepPaths(exec: Exec, step: Step, directory: string): string[] {
  if (!step.run || step.if !== undefined || step['continue-on-error']) return [];
  return testPaths(exec, step['working-directory'] ?? directory, step.run);
}

function workflowPaths(exec: Exec, source: string, checks: Set<string>): string[] {
  try {
    const workflow = Bun.YAML.parse(source) as Workflow;
    return Object.entries(workflow?.jobs ?? {}).flatMap(([id, job]) => {
      const name = job.name ?? id;
      if (![...checks].some(check => check === name || check.endsWith(` / ${name}`))) return [];
      const directory = job.defaults?.run?.['working-directory'] ?? workflow.defaults?.run?.['working-directory'] ?? '.';
      return (job.steps ?? []).flatMap(step => stepPaths(exec, step, directory));
    });
  } catch { return []; }
}

/** Only final-head checks and test scope identifiable from the passing job count as evidence. */
export function ciTestScopes(exec: Exec, ci: Partial<CiResult>): string[] {
  const head = output(exec, 'git', ['rev-parse', 'HEAD']);
  if (!(ci.hadChecks && head) || ci.headSha !== head || ci.status !== 'passed') return [];
  const checks = new Set(ci.passedChecks?.map(check => check.name));
  if (checks.size === 0) return [];
  const paths = output(exec, 'git', ['ls-tree', '-r', '--name-only', 'HEAD', '--', '.github/workflows']) ?? '';
  return paths.split('\n').filter(path => /\.ya?ml$/.test(path)).flatMap(path =>
    workflowPaths(exec, output(exec, 'git', ['show', `HEAD:${path}`]) ?? '', checks));
}

export function citesCiTest(exec: Exec, text: string, scopes: string[]): boolean {
  const paths = text.match(/[\w./-]+\.[\w]+/g) ?? [];
  return paths.map(path => path.replace(/^\.\//, '')).some(path =>
    isTestPath(path) && scopes.some(scope => scope === '.' || scope === path || path.startsWith(`${scope}/`)) &&
    output(exec, 'git', ['cat-file', '-t', `HEAD:${path}`]) === 'blob');
}
