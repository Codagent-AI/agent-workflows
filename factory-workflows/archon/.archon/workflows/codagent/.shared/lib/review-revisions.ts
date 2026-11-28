import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { type Exec, output } from './exec.ts';
import { remoteOf } from './forge.ts';
import { gitNetwork } from './git-network.ts';
import { readPages, sharedSources } from './review-pages.ts';
import { readJson, writeJson } from './run-files.ts';

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
  if (!branch) return;
  const result = gitNetwork(exec, ['fetch', branch.remote, `+refs/heads/${branch.base}:${branch.ref}`], sleep);
  writeJson(join(dir, 'review/base-refresh.json'), { ref: branch.ref, ...result });
  if (!result.ok) process.stderr.write('Could not refresh the pull request base. The saved base may be stale. See review/base-refresh.json.\n');
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

const reviewedPath = (dir: string) => join(dir, 'review/reviewed-commits.json');
const requestedPath = (dir: string) => join(dir, 'review/review-round-commits.json');
export const reviewedCommits = (dir: string) => readJson<string[]>(reviewedPath(dir), []);
/** Records the commits a review covered outside a review round, so they are not Late commit items. */
export function markReviewed(exec: Exec, dir: string, start: string, end: string): void {
  writeJson(reviewedPath(dir), [...new Set([...reviewedCommits(dir), ...reviewRevisions(exec, dir, start, end)])]);
}

const isCommit = (code: string) => /^[0-9a-f]{40}$/.test(code);
const answersFile = (dir: string, round: number) => join(dir, `review-answers-round-${round}.json`);

/** Each saved answer's option with the sources its question answers for on the page it came from. */
function answeredItems(dir: string, file: string): { option: string; sources: string[] }[] {
  const saved = file ? readJson<{ round?: number; answers?: { item: string; option: string }[] }>(file, {}) : {};
  const answers = saved.answers ?? [];
  const page = answers.length > 0 ? readPages(dir).find(entry => entry.round === saved.round) : undefined;
  const shared = page ? sharedSources(dir, page) : new Map<string, string[]>();
  return answers.map(choice => ({ option: choice.option, sources: shared.get(choice.item) ?? [choice.item] }));
}

/** The commits the saved answers sent to a review round: the commit sources of each item answered that way. */
export function reviewRoundCommits(dir: string, file: string): string[] {
  return [...new Set(answeredItems(dir, file).filter(entry => entry.option === 'review-round').flatMap(entry => entry.sources).filter(isCommit))];
}

/** A feedback review starts at the reviewed page's head, or earlier so it covers the commits the reviewer sent to a review round. The commits its range covers are saved for record-review. */
export function reviewRoundStart(exec: Exec, dir: string, answers: string, start: string): string {
  const commits = reviewRoundCommits(dir, answers);
  const isAncestor = (older: string, newer: string) => output(exec, 'git', ['merge-base', '--is-ancestor', older, newer]) !== undefined;
  const parents = commits.flatMap(sha => output(exec, 'git', ['rev-parse', '--verify', `${sha}^`]) ?? []);
  const first = parents.reduce((earliest, parent) => (isAncestor(parent, earliest) ? parent : earliest), start);
  // In the range first..HEAD: reachable from HEAD but not from first, including commits merged in from a side branch.
  writeJson(requestedPath(dir), commits.filter(sha => isAncestor(sha, 'HEAD') && !isAncestor(sha, first)));
  return first;
}

/** Once the feedback review has read its range, the review-round commits in that range count as reviewed. */
export function markReviewRoundDone(dir: string): void {
  writeJson(reviewedPath(dir), [...new Set([...reviewedCommits(dir), ...readJson<string[]>(requestedPath(dir), [])])]);
}

function answerRounds(dir: string): number[] {
  return readdirSync(dir).flatMap(file => /^review-answers-round-(\d+)\.json$/.exec(file)?.[1] ?? []).map(Number).sort((a, b) => a - b);
}

/** Commits sent to a review round, each with its item's sources. A later answer that picks another option for the item takes it back; a note, a merge or a blank answer does not. */
function sentCommits(dir: string): Map<string, string[]> {
  const sent = new Map<string, string[]>();
  // Within a round other options go first, so a review round chosen in any of the item's questions wins.
  const last = (entry: { option: string }) => Number(entry.option === 'review-round');
  for (const round of answerRounds(dir)) {
    const answered = answeredItems(dir, answersFile(dir, round)).filter(entry => entry.option).sort((a, b) => last(a) - last(b));
    for (const { option, sources } of answered) {
      for (const sha of sources.filter(isCommit)) option === 'review-round' ? sent.set(sha, sources) : sent.delete(sha);
    }
  }
  return sent;
}

/** The sources of each item sent to a review round whose commits no review has read yet. Answers alone don't close them. */
export function pendingReviewRound(dir: string): string[] {
  const reviewed = new Set(reviewedCommits(dir));
  return [...new Set([...sentCommits(dir)].filter(([sha]) => !reviewed.has(sha)).flatMap(([, sources]) => sources))];
}
