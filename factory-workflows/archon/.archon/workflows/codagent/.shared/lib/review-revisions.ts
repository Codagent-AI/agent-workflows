import { join } from 'node:path';
import { type Exec, output } from './exec.ts';
import { remoteOf } from './forge.ts';
import { gitNetwork } from './pull-request.ts';
import { readJson } from './run-files.ts';

export function commitParents(exec: Exec, sha: string): string[] {
  return gitOutput(exec, ['show', '-s', '--format=%P', sha]).split(' ').filter(Boolean);
}

function gitOutput(exec: Exec, args: string[]): string {
  const result = output(exec, 'git', args);
  if (result === undefined) throw new Error(`Could not read git revisions: git ${args.join(' ')}`);
  return result;
}

function baseRef(exec: Exec, dir: string) {
  const { base } = readJson<{ base?: string }>(join(dir, 'pull-request.json'), {});
  const remote = remoteOf(exec);
  return base && remote.ok ? { remote: remote.value.name, base, ref: `refs/remotes/${remote.value.name}/${base}` } : undefined;
}

export function refreshBase(exec: Exec, dir: string, sleep?: import('./exec.ts').Sleep) {
  const branch = baseRef(exec, dir);
  if (branch) gitNetwork(exec, ['fetch', branch.remote, `+refs/heads/${branch.base}:${branch.ref}`], sleep);
}

export function baseRevisions(exec: Exec, dir: string): string[] {
  const [, target] = readJson<string[]>(join(dir, 'review/merge-targets.json'), []);
  const refs = [target, baseRef(exec, dir)?.ref];
  return [...new Set(refs.flatMap(ref => {
    const sha = ref && output(exec, 'git', ['rev-parse', '--verify', `${ref}^{commit}`]);
    return sha ? [sha] : [];
  }))];
}

export function reviewRevisions(exec: Exec, dir: string, start: string, end: string): string[] {
  const revisions = gitOutput(exec, ['rev-list', '--first-parent', '--reverse', `${start}..${end}`]).split('\n').filter(Boolean);
  const base = baseRevisions(exec, dir);
  const excluded = base.length > 0 ? ['--not', ...base] : [];
  const baseCommits = new Set(gitOutput(exec, ['rev-list', `${start}..${end}`, ...excluded]).split('\n'));
  const commits = new Set<string>();
  for (const sha of revisions) {
    const [first, ...merged] = commitParents(exec, sha);
    for (const parent of merged) {
      const imported = gitOutput(exec, ['rev-list', '--reverse', `${first}..${parent}`, '--not', ...base, start]);
      for (const commit of imported.split('\n').filter(Boolean)) commits.add(commit);
    }
    if (baseCommits.has(sha)) commits.add(sha);
  }
  return [...commits];
}

export function feedbackScope(exec: Exec, dir: string, start: string, end: string) {
  const files = new Set<string>();
  const revisions: string[] = [];
  for (const sha of reviewRevisions(exec, dir, start, end)) {
    const flags = commitParents(exec, sha).length > 1 ? ['--remerge-diff'] : [];
    const changed = gitOutput(exec, ['show', ...flags, '--format=', '--name-only', sha, '--', '.', ':(exclude)openspec/']);
    if (!changed) continue;
    revisions.push(sha);
    for (const file of changed.split('\n')) files.add(file);
  }
  return { files: [...files].join('\n'), revisions: revisions.join('\n') };
}
