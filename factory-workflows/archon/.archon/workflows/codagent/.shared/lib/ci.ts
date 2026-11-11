// Waits for current-head CI on the branch's pull request and reports the result, as one
// bounded script node instead of an agent calling scripts in a loop.
//
// Judging comment meaning stays with the agent: a review bot's "still reviewing" notice is
// listed under informational bot comments, and the tester's handoff decides whether it
// leaves the status pending.
import { type PrComments, fetchComments } from './ci-comments.ts';
import type { Exec, Sleep } from './exec.ts';
import { output } from './exec.ts';

export type CiStatus = 'passed' | 'failed' | 'pending' | 'comments' | 'error';

export interface Check {
  name: string;
  state: string;
  bucket?: string;
  link?: string;
}

interface Review {
  login: string;
  state: string;
  body: string;
}


export interface CiResult {
  status: CiStatus;
  error: string;
  prUrl: string;
  /** The PR head the checks were read for. */
  headSha: string;
  /** Whether local HEAD or the PR head moved off headSha while CI was read. */
  headMoved: boolean;
  hadChecks: boolean;
  failedChecks: Check[];
  passedChecks: Check[];
  pendingChecks: Check[];
  blockingReviews: Review[];
  failedLogs: { runId: string; log: string }[];
  mergeable: string;
  conflictingFiles: string[];
  comments: PrComments | undefined;
  elapsedMinutes: number;
}

const stateOf = (check: Check): string => (check.bucket ?? check.state ?? '').toLowerCase();
const isPending = (check: Check): boolean => ['pending', 'in_progress', 'queued'].includes(stateOf(check));
const isFailed = (check: Check): boolean => ['fail', 'failure', 'cancel', 'cancelled'].includes(stateOf(check));
const isPassed = (check: Check): boolean =>
  ['pass', 'success', 'skipping', 'skipped', 'neutral'].includes(stateOf(check));

/** One JSON value per line, as `gh api --jq '.[]'` prints them. */
function jsonLines<T>(text: string): T[] {
  return text
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as T);
}

/** The latest non-pending review per reviewer that requests changes. */
export function blockingReviews(reviews: { user?: { login?: string }; state: string; body?: string }[]): Review[] {
  const latest = new Map<string, Review>();
  for (const review of reviews) {
    if (review.state === 'PENDING') continue;
    const login = review.user?.login ?? '';
    latest.set(login, { login, state: review.state, body: review.body ?? '' });
  }
  return [...latest.values()].filter(review => review.state === 'CHANGES_REQUESTED');
}

export function failedRunIds(checks: readonly Check[]): string[] {
  const ids = checks
    .map(check => /\/actions\/runs\/([0-9]+)\//.exec(check.link ?? '')?.[1])
    .filter((id): id is string => id !== undefined && id !== '');
  return [...new Set(ids)];
}


/** The final status, by this precedence. */
export function finalStatus(result: Pick<CiResult, 'failedChecks' | 'blockingReviews' | 'mergeable' | 'pendingChecks'>, comments: PrComments | undefined): CiStatus {
  if (result.failedChecks.length > 0 || result.blockingReviews.length > 0 || result.mergeable === 'CONFLICTING') {
    return 'failed';
  }
  if (comments?.hasComments) return 'comments';
  if (result.pendingChecks.length > 0 || result.mergeable === 'UNKNOWN') return 'pending';
  return 'passed';
}

export interface WaitOptions {
  maxMinutes: number;
  intervalSeconds: number;
  now?: () => number;
}

interface PrView {
  number: number;
  url: string;
  headRefOid: string;
  baseRefOid?: string;
  mergeable?: string;
}

const blank = (error: string): CiResult => ({
  status: 'error',
  error,
  prUrl: '',
  headSha: '',
  headMoved: false,
  hadChecks: false,
  failedChecks: [],
  passedChecks: [],
  pendingChecks: [],
  blockingReviews: [],
  failedLogs: [],
  mergeable: '',
  conflictingFiles: [],
  comments: undefined,
  elapsedMinutes: 0,
});

function viewPr(exec: Exec, fields: string): PrView | undefined {
  const viewed = exec('gh', ['pr', 'view', '--json', fields]);
  return viewed.status === 0 ? (JSON.parse(viewed.stdout) as PrView) : undefined;
}
/** The PR and repository a wait reads. */
interface Target {
  pr: PrView;
  owner: string;
  repo: string;
}

/** The wait's fixed inputs and the deadline it polls until. */
interface Waiter {
  exec: Exec;
  sleep: Sleep;
  options: WaitOptions;
  now: () => number;
  deadline: number;
  target: Target;
}

/** The result being filled in, and the base commit the PR last reported. */
interface Run {
  result: CiResult;
  baseOid: string;
}

const failure = (result: CiResult, error: string): CiResult => ({ ...result, status: 'error', error });

/** The PR and repository for the current branch, or an error result. */
function findTarget(exec: Exec): Target | CiResult {
  const pr = viewPr(exec, 'number,url,headRefOid,baseRefOid,mergeable');
  if (!pr) return blank('no PR found for the current branch');
  if (!pr.headRefOid) return blank('the PR head SHA is missing');
  const repoView = exec('gh', ['repo', 'view', '--json', 'owner,name']);
  if (repoView.status !== 0) return blank('failed to fetch repository info');
  const repoInfo = JSON.parse(repoView.stdout) as { owner: { login: string }; name: string };
  return { pr, owner: repoInfo.owner.login, repo: repoInfo.name };
}

/** The PR's checks, or an error message. A branch with no checks has none. */
function fetchChecks(exec: Exec): Check[] | string {
  const listed = exec('gh', ['pr', 'checks', '--json', 'name,state,bucket,link']);
  if (listed.status === 0) return JSON.parse(listed.stdout) as Check[];
  if (listed.stderr.includes('no checks reported')) return [];
  return `failed to fetch PR checks: ${listed.stderr.trim()}`;
}

/** The PR's reviews, or an error message. */
function fetchReviews(exec: Exec, target: Target): Review[] | string {
  const reviews = exec('gh', [
    'api',
    '--paginate',
    `repos/${target.owner}/${target.repo}/pulls/${String(target.pr.number)}/reviews?per_page=100`,
    '--jq',
    '.[]',
  ]);
  if (reviews.status !== 0) return `failed to fetch PR reviews: ${reviews.stderr.trim()}`;
  return blockingReviews(jsonLines(reviews.stdout));
}

/** Reads the PR's mergeable state once more; a failed read keeps the last one. */
function refreshMergeable(exec: Exec, run: Run): void {
  const merge = viewPr(exec, 'mergeable,baseRefOid');
  if (!merge) return;
  run.result.mergeable = merge.mergeable ?? '';
  run.baseOid = merge.baseRefOid ?? '';
}

/** Reads the PR's state into the result once; returns the number of checks, or an error message. */
function pollOnce(waiter: Waiter, run: Run): number | string {
  refreshMergeable(waiter.exec, run);
  const checks = fetchChecks(waiter.exec);
  if (typeof checks === 'string') return checks;
  const blocking = fetchReviews(waiter.exec, waiter.target);
  if (typeof blocking === 'string') return blocking;
  const { result } = run;
  result.hadChecks ||= checks.length > 0;
  result.pendingChecks = checks.filter(isPending);
  result.failedChecks = checks.filter(isFailed);
  result.passedChecks = checks.filter(isPassed);
  result.blockingReviews = blocking;
  return checks.length;
}

/** Whether polling again cannot change the outcome. */
function isSettled(result: CiResult, checkCount: number): boolean {
  if (result.mergeable === 'CONFLICTING' || result.failedChecks.length > 0 || result.blockingReviews.length > 0) {
    return true;
  }
  return (
    result.mergeable !== 'UNKNOWN' &&
    checkCount > 0 &&
    result.pendingChecks.length === 0 &&
    result.passedChecks.length === checkCount
  );
}

/** Polls until the outcome is settled or the deadline passes; returns an error message if a read fails. */
function pollUntilSettled(waiter: Waiter, run: Run): string | undefined {
  const waitMs = waiter.options.intervalSeconds * 1000;
  for (;;) {
    const polled = pollOnce(waiter, run);
    if (typeof polled === 'string') return polled;
    if (isSettled(run.result, polled) || waiter.now() + waitMs > waiter.deadline) return undefined;
    waiter.sleep(waitMs);
  }
}

/** Adds the conflicting files and the failed runs' logs to the result. */
function addFailureDetails(exec: Exec, run: Run): void {
  const { result } = run;
  if (result.mergeable === 'CONFLICTING') result.conflictingFiles = conflictingFiles(exec, run.baseOid, result.headSha);
  for (const runId of failedRunIds(result.failedChecks)) {
    const log = exec('gh', ['run', 'view', runId, '--log-failed']);
    result.failedLogs.push({ runId, log: (log.stdout || log.stderr).split('\n').slice(-100).join('\n') });
  }
}

/** Waits for the PR's checks to settle, then reports the checks, reviews and comments. */
export function waitForCi(exec: Exec, sleep: Sleep, options: WaitOptions): CiResult {
  const now = options.now ?? Date.now;
  const started = now();
  const target = findTarget(exec);
  if ('status' in target) return target;
  const { pr } = target;
  const result: CiResult = { ...blank(''), prUrl: pr.url, headSha: pr.headRefOid, mergeable: pr.mergeable ?? '' };
  const run: Run = { result, baseOid: pr.baseRefOid ?? '' };
  const waiter: Waiter = { exec, sleep, options, now, deadline: started + options.maxMinutes * 60_000, target };

  const problem = pollUntilSettled(waiter, run);
  if (problem !== undefined) return failure(result, problem);
  addFailureDetails(exec, run);
  const comments = fetchComments(exec, target.owner, target.repo, pr.number);
  if (typeof comments === 'string') return failure(result, comments);
  result.comments = comments;
  result.status = finalStatus(result, comments);
  const localHead = output(exec, 'git', ['rev-parse', 'HEAD']);
  const prHead = viewPr(exec, 'headRefOid')?.headRefOid;
  result.headMoved = localHead !== result.headSha || prHead !== result.headSha;
  result.elapsedMinutes = Math.round((now() - started) / 60_000);
  return result;
}

function conflictingFiles(exec: Exec, base: string, headSha: string): string[] {
  if (!(base && headSha)) return [];
  for (const commit of [base, headSha]) {
    if (exec('git', ['cat-file', '-e', `${commit}^{commit}`]).status !== 0) return [];
  }
  const merged = exec('git', ['merge-tree', '--name-only', '--no-messages', base, headSha]);
  return merged.stdout.split('\n').filter(line => line !== '' && !/^[0-9a-f]{40,64}$/.test(line));
}
