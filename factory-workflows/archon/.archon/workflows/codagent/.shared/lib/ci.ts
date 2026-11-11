// Waits for current-head CI on the branch's pull request and reports the result. Port of
// the wait-ci skill's check-ci.sh and get-pr-comments.sh, run as one bounded node instead
// of an agent calling the scripts in a loop.
//
// Judging comment meaning stays with the agent: a review bot's "still reviewing" notice is
// listed under informational bot comments, and the tester's handoff decides whether it
// leaves the status pending.
import type { Exec, Sleep } from './exec.ts';
import { output } from './exec.ts';

export type CiStatus = 'passed' | 'failed' | 'pending' | 'comments' | 'error';

interface Check {
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

export interface Thread {
  file: string;
  line: number | null;
  author: string;
  body: string;
}

export interface Comment {
  author: string;
  body: string;
}

export interface PrComments {
  hasComments: boolean;
  unresolvedThreads: Thread[];
  deferredThreads: Thread[];
  issueComments: Comment[];
  informationalBotComments: Comment[];
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

interface GraphAuthor {
  __typename?: string;
  login?: string;
}

interface GraphComment {
  author?: GraphAuthor | null;
  body?: string;
  path?: string;
  line?: number | null;
  originalLine?: number | null;
}

interface GraphPullRequest {
  author?: GraphAuthor | null;
  reviewThreads?: {
    pageInfo?: { hasNextPage?: boolean };
    nodes?: { isResolved: boolean; comments?: { nodes?: GraphComment[] } }[];
  };
  comments?: { pageInfo?: { hasNextPage?: boolean }; nodes?: GraphComment[] };
}

const isBot = (author: GraphAuthor | null | undefined): boolean => author?.__typename === 'Bot';

/**
 * Classifies the PR's comments. An unresolved thread is deferred, and does not block, when
 * the latest significant comment (after dropping the finding bot's trailing acks) is from
 * the PR author, or from a different bot than the one that raised it.
 */
export function classifyComments(pr: GraphPullRequest, prAuthorLogin = ''): PrComments {
  const prAuthor = prAuthorLogin || pr.author?.login || '';
  const unresolvedThreads: Thread[] = [];
  const deferredThreads: Thread[] = [];
  for (const thread of pr.reviewThreads?.nodes ?? []) {
    if (thread.isResolved) continue;
    const comments = thread.comments?.nodes ?? [];
    const first = comments[0];
    const findingAuthor = first?.author?.login ?? '';
    const findingIsBot = isBot(first?.author);
    let significant = comments;
    while (
      findingIsBot &&
      significant.length > 1 &&
      isBot(significant.at(-1)?.author) &&
      (significant.at(-1)?.author?.login ?? '') === findingAuthor
    ) {
      significant = significant.slice(0, -1);
    }
    const latest = significant.at(-1);
    const deferred =
      latest !== undefined &&
      ((!isBot(latest.author) && prAuthor !== '' && (latest.author?.login ?? '') === prAuthor) ||
        (isBot(latest.author) && significant.length > 1 && (latest.author?.login ?? '') !== findingAuthor));
    const entry: Thread = {
      file: first?.path ?? '',
      line: first?.line ?? first?.originalLine ?? null,
      author: first?.author?.login ?? 'unknown',
      body: first?.body ?? '',
    };
    (deferred ? deferredThreads : unresolvedThreads).push(entry);
  }
  const topLevel = (pr.comments?.nodes ?? []).filter(
    comment => prAuthor === '' || (comment.author?.login ?? '') !== prAuthor
  );
  const asComment = (comment: GraphComment): Comment => ({
    author: comment.author?.login ?? 'unknown',
    body: comment.body ?? '',
  });
  // Only explicit Bot actors are informational, so missing author metadata cannot hide feedback.
  const issueComments = topLevel.filter(comment => !isBot(comment.author)).map(asComment);
  const informationalBotComments = topLevel.filter(comment => isBot(comment.author)).map(asComment);
  return {
    hasComments: unresolvedThreads.length + issueComments.length > 0,
    unresolvedThreads,
    deferredThreads,
    issueComments,
    informationalBotComments,
  };
}

const COMMENTS_QUERY = `
query($owner: String!, $repo: String!, $prNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $prNumber) {
      author { __typename login }
      reviewThreads(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          isResolved
          comments(first: 10) { nodes { author { __typename login } body path line originalLine } }
        }
      }
      comments(first: 100) {
        pageInfo { hasNextPage }
        nodes { author { __typename login } body }
      }
    }
  }
}`;

function fetchComments(exec: Exec, owner: string, repo: string, number: number): PrComments | string {
  const result = exec('gh', [
    'api',
    'graphql',
    '-f',
    `query=${COMMENTS_QUERY}`,
    '-f',
    `owner=${owner}`,
    '-f',
    `repo=${repo}`,
    '-F',
    `prNumber=${String(number)}`,
  ]);
  if (result.status !== 0) return `failed to fetch PR comments: ${result.stderr.trim()}`;
  const parsed = JSON.parse(result.stdout) as { data?: { repository?: { pullRequest?: GraphPullRequest } } };
  const pr = parsed.data?.repository?.pullRequest ?? {};
  // Feedback past the first page would be unseen, so the round cannot report it as passed.
  if (pr.reviewThreads?.pageInfo?.hasNextPage || pr.comments?.pageInfo?.hasNextPage) {
    return 'the PR has more than 100 review threads or top-level comments; read them on GitHub';
  }
  return classifyComments(pr);
}

/** The final status, by the wait-ci skill's precedence. */
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

export function waitForCi(exec: Exec, sleep: Sleep, options: WaitOptions): CiResult {
  const now = options.now ?? Date.now;
  const started = now();
  const deadline = started + options.maxMinutes * 60_000;
  const pr = viewPr(exec, 'number,url,headRefOid,baseRefOid,mergeable');
  if (!pr) return blank('no PR found for the current branch');
  if (!pr.headRefOid) return blank('the PR head SHA is missing');
  const repoView = exec('gh', ['repo', 'view', '--json', 'owner,name']);
  if (repoView.status !== 0) return blank('failed to fetch repository info');
  const repoInfo = JSON.parse(repoView.stdout) as { owner: { login: string }; name: string };
  const result: CiResult = { ...blank(''), prUrl: pr.url, headSha: pr.headRefOid, mergeable: pr.mergeable ?? '' };
  let baseOid = pr.baseRefOid ?? '';

  for (;;) {
    const merge = viewPr(exec, 'mergeable,baseRefOid');
    if (merge) {
      result.mergeable = merge.mergeable ?? '';
      baseOid = merge.baseRefOid ?? '';
    }
    let checks: Check[] = [];
    const listed = exec('gh', ['pr', 'checks', '--json', 'name,state,bucket,link']);
    if (listed.status === 0) {
      checks = JSON.parse(listed.stdout) as Check[];
    } else if (!listed.stderr.includes('no checks reported')) {
      return { ...result, status: 'error', error: `failed to fetch PR checks: ${listed.stderr.trim()}` };
    }
    const reviews = exec('gh', [
      'api',
      '--paginate',
      `repos/${repoInfo.owner.login}/${repoInfo.name}/pulls/${String(pr.number)}/reviews?per_page=100`,
      '--jq',
      '.[]',
    ]);
    if (reviews.status !== 0) {
      return { ...result, status: 'error', error: `failed to fetch PR reviews: ${reviews.stderr.trim()}` };
    }
    result.hadChecks ||= checks.length > 0;
    result.pendingChecks = checks.filter(isPending);
    result.failedChecks = checks.filter(isFailed);
    result.passedChecks = checks.filter(isPassed);
    result.blockingReviews = blockingReviews(jsonLines(reviews.stdout));
    const terminal =
      result.mergeable === 'CONFLICTING' ||
      result.failedChecks.length > 0 ||
      result.blockingReviews.length > 0 ||
      (result.mergeable !== 'UNKNOWN' &&
        checks.length > 0 &&
        result.pendingChecks.length === 0 &&
        result.passedChecks.length === checks.length);
    if (terminal || now() + options.intervalSeconds * 1000 > deadline) break;
    sleep(options.intervalSeconds * 1000);
  }

  if (result.mergeable === 'CONFLICTING') result.conflictingFiles = conflictingFiles(exec, baseOid, result.headSha);
  for (const runId of failedRunIds(result.failedChecks)) {
    const log = exec('gh', ['run', 'view', runId, '--log-failed']);
    result.failedLogs.push({ runId, log: (log.stdout || log.stderr).split('\n').slice(-100).join('\n') });
  }
  const comments = fetchComments(exec, repoInfo.owner.login, repoInfo.name, pr.number);
  if (typeof comments === 'string') return { ...result, status: 'error', error: comments };
  result.comments = comments;
  result.status = finalStatus(result, comments);
  const localHead = output(exec, 'git', ['rev-parse', 'HEAD']);
  const prHead = viewPr(exec, 'headRefOid')?.headRefOid;
  result.headMoved = localHead !== result.headSha || prHead !== result.headSha;
  result.elapsedMinutes = Math.round((now() - started) / 60_000);
  return result;
}

function conflictingFiles(exec: Exec, base: string, headSha: string): string[] {
  if (!base || !headSha) return [];
  for (const commit of [base, headSha]) {
    if (exec('git', ['cat-file', '-e', `${commit}^{commit}`]).status !== 0) return [];
  }
  const merged = exec('git', ['merge-tree', '--name-only', '--no-messages', base, headSha]);
  return merged.stdout.split('\n').filter(line => line !== '' && !/^[0-9a-f]{40,64}$/.test(line));
}

const checkLine = (check: Check): string =>
  `- **${check.name}** (${check.state})${check.link ? `\n  Link: ${check.link}` : ''}`;
const threadLine = (thread: Thread): string =>
  `- **${thread.author}** on \`${thread.file}\` line ${String(thread.line ?? '?')}: ${thread.body}`;
const commentLine = (comment: Comment, kind = ''): string => `- **${comment.author}**${kind}: ${comment.body}`;

/** The report in the wait-ci skill's output format. */
export function renderReport(result: CiResult): string {
  const lines = [`## CI Status: ${result.status}`, '', `**PR:** ${result.prUrl || 'unknown'}`];
  lines.push(`**Head:** ${result.headSha || 'unknown'}${result.headMoved ? ' (local HEAD or the PR head has since moved)' : ''}`);
  lines.push(`**Elapsed:** ~${String(result.elapsedMinutes)} minutes`);
  if (result.error) lines.push('', `**Error:** ${result.error}`);
  if (!result.hadChecks && result.status !== 'error') lines.push('', 'No CI checks are configured or reported for this pull request.');
  const section = (title: string, items: string[]): void => {
    if (items.length > 0) lines.push('', `### ${title}`, ...items);
  };
  section(
    'Failed Checks',
    result.failedChecks.map(check => {
      const runId = failedRunIds([check])[0];
      const log = result.failedLogs.find(entry => entry.runId === runId)?.log;
      return log ? `${checkLine(check)}\n  Logs:\n  \`\`\`\n${log}\n  \`\`\`` : checkLine(check);
    })
  );
  section('Merge Conflicts', result.conflictingFiles.map(file => `- \`${file}\``));
  section('Blocking Reviews', result.blockingReviews.map(review => `- **${review.login}**: ${review.body}`));
  const comments = result.comments;
  if (comments) {
    section('PR Comments', [
      ...comments.unresolvedThreads.map(threadLine),
      ...comments.issueComments.map(comment => commentLine(comment, ' (issue comment)')),
    ]);
    section('Deferred Threads', comments.deferredThreads.map(threadLine));
    section('Informational Bot Comments', comments.informationalBotComments.map(comment => commentLine(comment)));
  }
  section('Passing Checks', result.passedChecks.map(check => `- ${check.name} (${check.state})`));
  section('Still Running', result.pendingChecks.map(check => `- ${check.name} (${check.state})`));
  return `${lines.join('\n')}\n`;
}
