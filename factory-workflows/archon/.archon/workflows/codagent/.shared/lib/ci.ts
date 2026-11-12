// Waits for current-head CI on the branch's pull request and reports the result, as one
// bounded script node instead of an agent calling scripts in a loop. Every forge read goes
// through `archon forge` (forge.ts).
//
// Judging comment meaning stays with the agent: a review bot's "still reviewing" notice is
// listed under informational bot comments, and the tester's handoff decides whether it
// leaves the status pending.
import { type PrComments, fetchComments } from './ci-comments.ts';
import type { Sleep } from './exec.ts';
import { output } from './exec.ts';
import { OPS, type PrView, type Repo } from './forge.ts';
import { type Tools, lookupPr } from './pull-request.ts';

export type CiStatus = 'passed' | 'failed' | 'pending' | 'comments' | 'error';

interface Unit {
  kind: string;
  id: string;
  name: string;
}

/** One check as `checks.state` reports it. `state` is the forge's classification. */
interface RawCheck {
  unit: Unit;
  nativeState: string;
  nativeResult: string | null;
  state: string;
}

export interface Check {
  name: string;
  /** green, red, pending, gated or unknown. */
  state: string;
  /** The vendor's own word for it, such as failure or in_progress. */
  detail: string;
  unit: Unit;
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
  failedLogs: { name: string; log: string }[];
  /** clean, conflict or unknown, as `pr.merge-state` reports it. */
  mergeable: string;
  conflictingFiles: string[];
  comments: PrComments | undefined;
  elapsedMinutes: number;
}

const toCheck = (raw: RawCheck): Check => ({
  name: raw.unit.name,
  state: raw.state,
  detail: raw.nativeResult ?? raw.nativeState,
  unit: raw.unit,
});

// A check the forge cannot classify, or that waits for an approval, has not passed.
const isFailed = (check: Check): boolean => check.state === 'red';
const isPassed = (check: Check): boolean => check.state === 'green';
const isPending = (check: Check): boolean => !(isFailed(check) || isPassed(check));

interface ReviewItem {
  kind: string;
  author: { login: string | null } | null;
  state: string | null;
  createdAt: string | null;
  body: string;
}

/** The latest non-pending review per reviewer that requests changes. */
export function blockingReviews(items: readonly ReviewItem[]): Review[] {
  const reviews = items
    .filter(item => item.kind === 'review' && item.state !== 'PENDING')
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  const latest = new Map<string, Review>();
  for (const review of reviews) {
    const login = review.author?.login ?? '';
    latest.set(login, { login, state: review.state ?? '', body: review.body });
  }
  return [...latest.values()].filter(review => review.state === 'CHANGES_REQUESTED');
}

/** The final status, by this precedence. */
export function finalStatus(
  result: Pick<CiResult, 'failedChecks' | 'blockingReviews' | 'mergeable' | 'pendingChecks'>,
  comments: PrComments | undefined
): CiStatus {
  if (result.failedChecks.length > 0 || result.blockingReviews.length > 0 || result.mergeable === 'conflict') {
    return 'failed';
  }
  if (comments?.hasComments) return 'comments';
  if (result.pendingChecks.length > 0 || result.mergeable === 'unknown') return 'pending';
  return 'passed';
}

export interface WaitOptions {
  maxMinutes: number;
  intervalSeconds: number;
  now?: () => number;
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

/** The pull request a wait reads. */
interface Target {
  repo: Repo;
  ref: { repo: Repo; number: number };
  view: PrView;
}

/** The wait's fixed inputs and the deadline it polls until. */
interface Waiter {
  tools: Tools;
  sleep: Sleep;
  options: WaitOptions;
  now: () => number;
  deadline: number;
  target: Target;
}

/** The result being filled in. */
interface Run {
  result: CiResult;
}

const failure = (result: CiResult, error: string): CiResult => ({ ...result, status: 'error', error });

/** The branch's pull request, or an error result. */
function findTarget(tools: Tools): Target | CiResult {
  const found = lookupPr(tools);
  if (!found.ok) return blank(found.problem);
  const { view, repo } = found.value;
  if (view === null) return blank('no PR found for the current branch');
  if (!view.pr.head_revision) return blank('the PR head SHA is missing');
  return { repo, ref: { repo, number: view.pr.number }, view };
}

/** The PR's checks, or an error message. A branch with no checks has none. */
function fetchChecks({ tools, target }: Waiter): Check[] | string {
  const listed = tools.forge.call<{ units: RawCheck[] }>(OPS.checks, { ref: target.ref });
  return listed.ok ? listed.value.units.map(toCheck) : `failed to fetch PR checks: ${listed.problem}`;
}

/** The PR's blocking reviews, or an error message. */
function fetchReviews({ tools, target }: Waiter): Review[] | string {
  const reviews = tools.forge.call<{ items: ReviewItem[] }>(OPS.reviews, { ref: target.ref });
  return reviews.ok ? blockingReviews(reviews.value.items) : `failed to fetch PR reviews: ${reviews.problem}`;
}

/** Reads the PR's mergeable state once more; returns an error message if it cannot. */
function refreshMergeable({ tools, target }: Waiter, run: Run): string | undefined {
  const state = tools.forge.call<{ mergeable: string }>(OPS.mergeState, { ref: target.ref });
  if (!state.ok) return `failed to fetch PR merge state: ${state.problem}`;
  run.result.mergeable = state.value.mergeable;
  return undefined;
}

/** Reads the PR's state into the result once; returns the number of checks, or an error message. */
function pollOnce(waiter: Waiter, run: Run): number | string {
  const unmerged = refreshMergeable(waiter, run);
  if (unmerged !== undefined) return unmerged;
  const checks = fetchChecks(waiter);
  if (typeof checks === 'string') return checks;
  const blocking = fetchReviews(waiter);
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
  if (result.mergeable === 'conflict' || result.failedChecks.length > 0 || result.blockingReviews.length > 0) {
    return true;
  }
  return (
    result.mergeable !== 'unknown' &&
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

// A matrix of failing jobs would fill the report; the first few say what is wrong.
const MAX_LOGGED_CHECKS = 10;
const LOG_LINES = 100;

/** The last lines of one failed check's log, or why there is none. */
function failedLog({ tools, target }: Waiter, check: Check): string {
  const read = tools.forge.call<{ log: { kind: string; text?: string; reason?: string } }>(OPS.logs, {
    repo: target.repo,
    unit: check.unit,
  });
  if (!read.ok) return read.problem;
  const { log } = read.value;
  return log.kind === 'text' ? (log.text ?? '').split('\n').slice(-LOG_LINES).join('\n') : `no log (${log.reason ?? 'unavailable'})`;
}

/** The files a merge of the PR's head into its base would conflict on. */
function conflictingFiles({ tools }: Waiter, base: string, headSha: string): string[] {
  if (!(base && headSha)) return [];
  for (const commit of [base, headSha]) {
    if (tools.exec('git', ['cat-file', '-e', `${commit}^{commit}`]).status !== 0) return [];
  }
  const merged = tools.exec('git', ['merge-tree', '--name-only', '--no-messages', base, headSha]);
  return merged.stdout.split('\n').filter(line => line !== '' && !/^[0-9a-f]{40,64}$/.test(line));
}

/** Adds the conflicting files and the failed checks' logs to the result. */
function addFailureDetails(waiter: Waiter, run: Run): void {
  const { result } = run;
  if (result.mergeable === 'conflict') {
    const base = lookupPr(waiter.tools);
    const baseRevision = base.ok ? (base.value.view?.pr.base_revision ?? '') : '';
    result.conflictingFiles = conflictingFiles(waiter, baseRevision, result.headSha);
  }
  for (const check of result.failedChecks.slice(0, MAX_LOGGED_CHECKS)) {
    result.failedLogs.push({ name: check.name, log: failedLog(waiter, check) });
  }
}

/** Whether local HEAD or the PR head is no longer the head CI was read for. */
function headMoved(tools: Tools, headSha: string): boolean {
  const localHead = output(tools.exec, 'git', ['rev-parse', 'HEAD']);
  const found = lookupPr(tools);
  const prHead = found.ok ? found.value.view?.pr.head_revision : undefined;
  return localHead !== headSha || prHead !== headSha;
}

/** Waits for the PR's checks to settle, then reports the checks, reviews and comments. */
export function waitForCi(tools: Tools, sleep: Sleep, options: WaitOptions): CiResult {
  const now = options.now ?? Date.now;
  const started = now();
  const target = findTarget(tools);
  if ('status' in target) return target;
  const { pr } = target.view;
  const result: CiResult = { ...blank(''), prUrl: pr.url, headSha: pr.head_revision ?? '' };
  const run: Run = { result };
  const waiter: Waiter = { tools, sleep, options, now, deadline: started + options.maxMinutes * 60_000, target };

  const problem = pollUntilSettled(waiter, run);
  if (problem !== undefined) return failure(result, problem);
  addFailureDetails(waiter, run);
  // Stays on gh: the forge's actor record has no account type (bot test needs __typename).
  const [owner = '', name = ''] = target.repo.path.split('/');
  const comments = fetchComments(tools.exec, owner, name, target.ref.number);
  if (typeof comments === 'string') return failure(result, comments);
  result.comments = comments;
  result.status = finalStatus(result, comments);
  result.headMoved = headMoved(tools, result.headSha);
  result.elapsedMinutes = Math.round((now() - started) / 60_000);
  return result;
}
