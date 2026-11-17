// Keep pre-existing spec edits out of the archive commit, including edits in an owned file.
import { join } from 'node:path';
import { type Exec, output } from './exec.ts';
import { readJson, writeJson } from './run-files.ts';
interface LocalSpecs {
  paths: string[]; staged: string; unstaged: string; restored: boolean;
  expected?: string; blobs?: Record<string, string>; error?: string;
}
interface Input { exec: Exec; dir: string; }
const file = (input: Input): string => join(input.dir, 'archive/local-specs.json');
function git(exec: Exec, args: string[], input?: string): string {
  const result = exec('git', args, { input });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
function differences(exec: Exec, paths: string[]): string {
  return JSON.stringify([git(exec, ['diff', '--cached', '--binary', '--', ...paths]), git(exec, ['diff', '--binary', '--', ...paths])]);
}
export function suspendSpecs(input: Input): void {
  const prior = readJson<LocalSpecs | null>(file(input), null);
  if (prior && !prior.restored) return;
  const changed = [[], ['--cached']].flatMap(flags => git(input.exec, ['diff', ...flags, '--name-only', '-z', '--', 'openspec/specs/']).split('\0').filter(Boolean));
  const paths = [...new Set(changed)];
  if (paths.length === 0) return;
  const local: LocalSpecs = { paths, staged: git(input.exec, ['diff', '--cached', '--binary', '--', ...paths]), unstaged: git(input.exec, ['diff', '--binary', '--', ...paths]), restored: false };
  writeJson(file(input), local);
  git(input.exec, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...paths]);
}
function applyPatch(exec: Exec, patch: string): void {
  if (patch) git(exec, ['apply', '--3way', '--index', '--whitespace=nowarn'], patch);
}
export function restoreSpecs(input: Input): void {
  const local = readJson<LocalSpecs | null>(file(input), null);
  if (!local || local.restored) return;
  if (local.error) throw new Error(local.error);
  local.blobs = Object.fromEntries(local.paths.map(path => [path, output(input.exec, 'git', ['rev-parse', `:${path}`]) ?? 'missing']));
  try {
    applyPatch(input.exec, local.staged);
    const index = git(input.exec, ['write-tree']).trim();
    try { applyPatch(input.exec, local.unstaged); }
    finally { git(input.exec, ['read-tree', index]); }
    local.restored = true; local.expected = differences(input.exec, local.paths);
  } catch (error) {
    local.error = `Could not restore pre-existing spec edits; original patches retained in ${file(input)}: ${String(error)}`;
    throw new Error(local.error);
  } finally { writeJson(file(input), local); }
}
export function restoredSpecPaths(input: Input): string[] {
  const local = readJson<LocalSpecs | null>(file(input), null);
  return local?.restored ? local.paths : [];
}
export function localSpecProblems(input: Input): string[] {
  const local = readJson<LocalSpecs | null>(file(input), null);
  if (!local) return [];
  if (!local.restored) return [local.error ?? 'pre-existing spec edits have not been restored'];
  const problems: string[] = [];
  if (differences(input.exec, local.paths) !== local.expected) problems.push('restored staged or unstaged spec edits were altered');
  for (const path of local.paths) {
    const committed = output(input.exec, 'git', ['rev-parse', `HEAD:${path}`]) ?? 'missing';
    if (committed !== local.blobs?.[path]) problems.push(`archive commit changed preserved spec contents: ${path}`);
  }
  return problems;
}
