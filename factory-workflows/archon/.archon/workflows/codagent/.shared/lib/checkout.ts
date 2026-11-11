// Reads the checkout observation Archon records when a node starts, bound into a script
// as `"$<node>.execution.checkoutStart"` (reference/workflow-language.md, "Reading where a
// node started"). The binding arrives as JSON in one of four shapes:
//
//   - `git` with a commit, and a clean worktree or a dirty one whose manifest file under
//     the run's artifacts lists each path that differed from the commit;
//   - `git` with no commit (an unborn branch), `not_git` and `unavailable`, which the
//     checks here refuse, because they need a commit to compare with.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type CheckResult, fail } from './check.ts';

/** Where a node started: its commit, and the paths already changed from it. */
export interface CheckoutStart {
  commit: string;
  dirtyPaths: ReadonlySet<string>;
}

export type Observed = { start: CheckoutStart } | { failure: CheckResult };

interface Manifest {
  entries: { path: string | { base64: string } }[];
}

interface Observation {
  kind?: string;
  commit?: string | null;
  worktree?: { status?: string; manifest?: { pointer?: { path?: string }; sha256?: string } };
}

const unusable = (why: string): Observed => ({ failure: fail(`could not read where the node started: ${why}`) });

function parse(raw: string): Observation | undefined {
  try {
    return JSON.parse(raw) as Observation;
  } catch {
    return undefined;
  }
}

/** The paths of the dirty worktree's manifest, or a problem. */
function manifestPaths(observation: Observation, artifactsDir: string): Set<string> | string {
  const manifest = observation.worktree?.manifest;
  if (manifest?.pointer?.path === undefined || manifest.sha256 === undefined) return 'a dirty start names no manifest';
  let text: string;
  try {
    text = readFileSync(join(artifactsDir, manifest.pointer.path), 'utf8');
  } catch {
    return `the manifest ${manifest.pointer.path} is unreadable`;
  }
  if (createHash('sha256').update(text, 'utf8').digest('hex') !== manifest.sha256) {
    return `the manifest ${manifest.pointer.path} does not match its recorded digest`;
  }
  const entries = (JSON.parse(text) as Manifest).entries;
  return new Set(entries.map(({ path }) => (typeof path === 'string' ? path : Buffer.from(path.base64, 'base64').toString())));
}

/** The commit a node started on. With `withPaths`, also the paths that were already changed. */
export function checkoutStart(raw: string, artifactsDir: string, withPaths = true): Observed {
  const observation = parse(raw);
  if (observation?.kind !== 'git') return unusable(`the checkout is ${observation?.kind ?? 'unreadable'}`);
  if (typeof observation.commit !== 'string') return unusable('the checkout has no commit yet');
  const commit = observation.commit;
  if (!withPaths || observation.worktree?.status === 'clean') return { start: { commit, dirtyPaths: new Set() } };
  const paths = manifestPaths(observation, artifactsDir);
  return typeof paths === 'string' ? unusable(paths) : { start: { commit, dirtyPaths: paths } };
}
