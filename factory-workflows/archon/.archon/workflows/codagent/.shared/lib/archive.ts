// Archive transition, isolated commit and independent verification of the owned delta.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { type Exec, output } from './exec.ts';
import { type CheckResult, fail, pass } from './check.ts';
import { readJson, recordStep, writeJson } from './run-files.ts';
interface ArchiveState {
  start: string; archive_dir: string; owned_delta: string[];
  before: string; transition: CheckResult; commit_error?: string;
}
export interface ArchiveInput { exec: Exec; dir: string; name: string; }
const active = (name: string): string => `openspec/changes/${name}`;
export function archiveFolders(name: string): string[] {
  const root = 'openspec/changes/archive';
  return existsSync(root) ? readdirSync(root).filter(folder => /^\d{4}-\d{2}-\d{2}-/.test(folder) && folder.slice(11) === name && statSync(join(root, folder)).isDirectory()).map(folder => join(root, folder)) : [];
}
function command(exec: Exec, program: string, args: string[]): string {
  const result = exec(program, args);
  if (result.status !== 0) throw new Error(`${program} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}
function names(text: string): string[] { return text.split('\0').filter(Boolean); }
function fingerprint(exec: Exec, owned: string[]): string {
  const paths = owned;
  const staged = command(exec, 'git', ['diff', '--cached', '--binary', '--no-renames', '--', ...paths]);
  const unstaged = command(exec, 'git', ['diff', '--binary', '--no-renames', '--', ...paths]);
  return createHash('sha256').update(`${staged}\n${unstaged}`).digest('hex');
}
export function archiveMessage(name: string): string {
  const ticket = /^([a-z][a-z0-9]*)-(\d+)-.+$/.exec(name);
  return ticket ? `${ticket[1].toUpperCase()}-${ticket[2]}: Archive change` : `[archive] chore: archive openspec documents for ${name}`;
}
function initialState(input: ArchiveInput): ArchiveState {
  const start = command(input.exec, 'git', ['rev-parse', 'HEAD']);
  return { start, archive_dir: '', owned_delta: [active(input.name)], before: '', transition: fail('archive not attempted') };
}
function transition(input: ArchiveInput, state: ArchiveState): void {
  const folders = archiveFolders(input.name);
  if (!existsSync(active(input.name)) && folders.length === 1) {
    state.archive_dir = folders[0]; return;
  }
  command(input.exec, 'openspec', ['validate', '--type', 'change', input.name]);
  command(input.exec, 'openspec', ['archive', input.name, '--yes']);
  const after = archiveFolders(input.name);
  if (after.length !== 1) throw new Error(`expected exactly one archive folder; found ${after.length}: ${after.join(', ')}`);
  state.archive_dir = after[0];
}
function specFiles(root: string): Record<string, string> {
  if (!existsSync(root)) return {};
  return Object.assign({}, ...readdirSync(root).map(name => {
    const file = join(root, name);
    return statSync(file).isDirectory() ? specFiles(file) : { [file]: createHash('sha256').update(readFileSync(file)).digest('hex') };
  }));
}
function archivePaths(input: ArchiveInput, state: ArchiveState): string[] {
  const baseline = readJson<Record<string, string>>(join(input.dir, 'archive/specs-before.json'), {});
  const current = specFiles('openspec/specs');
  const specs = [...new Set([...Object.keys(baseline), ...Object.keys(current)])].filter(path => baseline[path] !== current[path]);
  return [...new Set([...state.owned_delta, active(input.name), ...archiveFolders(input.name), ...specs])];
}
function commitArchive(input: ArchiveInput, state: ArchiveState): void {
    if (!command(input.exec, 'git', ['status', '--porcelain', '--', ...state.owned_delta])) return;
    command(input.exec, 'git', ['add', '-A', '--', ...state.owned_delta]);
    const changed = output(input.exec, 'git', ['diff', '--cached', '--name-only', '--', ...state.owned_delta]);
    if (changed) command(input.exec, 'git', ['commit', '--only', '-m', archiveMessage(input.name), '--', ...state.owned_delta]);

}
export function archiveChange(input: ArchiveInput): CheckResult {
  const file = join(input.dir, 'archive/state.json');
  const state = readJson<ArchiveState>(file, initialState(input));
  // Capture the full pre-transition diffs and exclude only the final owned paths afterwards.
  const beforeFile = join(input.dir, 'archive/before.json');
  const before = readJson<Record<string, string> | null>(beforeFile, null);
  const specBaseline = join(input.dir, 'archive/specs-before.json');
  writeJson(specBaseline, readJson(specBaseline, specFiles('openspec/specs')));
  const baseline = before ?? capturePaths(input.exec);
  if (!before) writeJson(beforeFile, baseline);
  try {
    transition(input, state);
    state.owned_delta = archivePaths(input, state);
    const folders = archiveFolders(input.name);
    if (folders.length !== 1) throw new Error(`expected exactly one archive folder; found: ${folders.join(', ') || 'none'}`);
    state.archive_dir = folders[0];
    state.before = baselineFingerprint(baseline, state.owned_delta);
    state.transition = pass(); writeJson(file, state);
    commitArchive(input, state);
    return pass();
  } catch (error) {
    state.owned_delta = archivePaths(input, state);
    state.archive_dir = archiveFolders(input.name)[0] ?? '';
    state.before = baselineFingerprint(baseline, state.owned_delta);
    if (state.transition.ok) state.commit_error = String(error);
    else state.transition = fail(String(error));
    writeJson(file, state); return state.transition.ok ? pass() : fail(String(error));
  }
}
function capturePaths(exec: Exec): Record<string, string> {
  const paths = [...new Set([...names(command(exec, 'git', ['diff', '--name-only', '-z'])), ...names(command(exec, 'git', ['diff', '--cached', '--name-only', '-z']))])];
  return Object.fromEntries(paths.map(path => [path, fingerprint(exec, [`:(literal)${path}`])]));
}
function baselineFingerprint(baseline: Record<string, string>, owned: string[]): string {
  return JSON.stringify(Object.entries(baseline).filter(([path]) => !owned.some(prefix => path === prefix || path.startsWith(`${prefix}/`))).sort());
}
function commitProblems(input: ArchiveInput, state: ArchiveState): string[] {
  const problems: string[] = [];
  const changed = names(command(input.exec, 'git', ['diff', '--name-only', '-z', '--no-renames', state.start, 'HEAD']));
  const owned = (path: string): boolean => state.owned_delta.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
  const commits = command(input.exec, 'git', ['log', '--format=', '--name-only', '--no-renames', `${state.start}..HEAD`]).split('\n').filter(Boolean);
  const reused = command(input.exec, 'git', ['ls-tree', '--name-only', 'HEAD', '--', state.archive_dir]) !== '';
  if ((changed.length === 0 && !reused) || [...changed, ...commits].some(path => !owned(path))) problems.push('archive commits do not hold exactly the archive paths');
  if (command(input.exec, 'git', ['status', '--porcelain', '--', ...state.owned_delta])) problems.push('archive paths remain uncommitted');
  if (baselineFingerprint(capturePaths(input.exec), state.owned_delta) !== state.before) problems.push('unrelated staged or unstaged changes were altered');
  if (problems.length > 0 && state.commit_error) problems.push(state.commit_error);
  return problems;
}
export function verifyArchive(input: ArchiveInput): CheckResult {
  const state = readJson<ArchiveState | null>(join(input.dir, 'archive/state.json'), null);
  if (!state?.transition.ok) return fail(state?.transition.problems ?? 'archive has no state');
  const problems: string[] = [];
  if (existsSync(active(input.name)) || command(input.exec, 'git', ['ls-files', '--', active(input.name)])) problems.push('active change folder remains in worktree or index');
  const folders = archiveFolders(input.name);
  if (folders.length !== 1 || !existsSync(state.archive_dir)) problems.push(`expected one archive folder: ${folders.join(', ') || 'none'}`);
  problems.push(...commitProblems(input, state));
  return problems.length > 0 ? fail(problems) : pass();
}
export function recordArchive(input: ArchiveInput): { change_folder: string } {
  const state = readJson<ArchiveState | null>(join(input.dir, 'archive/state.json'), null);
  let result: CheckResult;
  try { result = verifyArchive(input); } catch (error) { result = fail(String(error)); }
  const folders = archiveFolders(input.name);
  const folder = !existsSync(active(input.name)) && folders.length === 1 ? folders[0] : active(input.name);
  recordStep(input.dir, 'archive', { ...result, remaining: result.ok ? '' : `Repair archive; retained paths: ${state?.owned_delta.join(', ') ?? folder}` });
  return { change_folder: folder };
}
