import { join } from 'node:path';
import { type Exec, output } from './exec.ts';
import { remoteOf } from './forge.ts';
import { readJson } from './run-files.ts';

export function commitParents(exec: Exec, sha: string): string[] {
  return gitOutput(exec, ['show', '-s', '--format=%P', sha]).split(' ').filter(Boolean);
}

function gitOutput(exec: Exec, args: string[]): string {
  const result = output(exec, 'git', args);
  if (result === undefined) throw new Error(`Could not read git revisions: git ${args.join(' ')}`);
  return result;
}

function recordedBase(exec: Exec, dir: string): string | undefined {
  const [, target] = readJson<string[]>(join(dir, 'review/merge-targets.json'), []);
  const { base } = readJson<{ base?: string }>(join(dir, 'pull-request.json'), {});
  const remote = base ? remoteOf(exec) : undefined;
  const ref = target || (remote?.ok ? `refs/remotes/${remote.value.name}/${base}` : undefined);
  return ref && output(exec, 'git', ['rev-parse', '--verify', `${ref}^{commit}`]);
}

export function reviewRevisions(exec: Exec, dir: string, start: string, end: string): string[] {
  const revisions = gitOutput(exec, ['rev-list', '--first-parent', '--reverse', `${start}..${end}`]).split('\n').filter(Boolean);
  const base = recordedBase(exec, dir);
  if (!base) return revisions;
  const commits = new Set<string>();
  for (const sha of revisions) {
    const [first, ...merged] = commitParents(exec, sha);
    for (const parent of merged) {
      const imported = gitOutput(exec, ['rev-list', '--reverse', `${first}..${parent}`, '--not', base, start]);
      for (const commit of imported.split('\n').filter(Boolean)) commits.add(commit);
    }
    commits.add(sha);
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
