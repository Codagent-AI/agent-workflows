// The pull request's comments for the CI report: review threads and top-level comments,
// read through GitHub's GraphQL API and sorted into what blocks and what is informational.
import type { Exec } from './exec.ts';

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

interface CommentPage { pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }; nodes?: GraphComment[]; }
interface GraphThread { id?: string; isResolved: boolean; comments?: CommentPage; }
interface GraphPullRequest {
  author?: GraphAuthor | null;
  reviewThreads?: {
    pageInfo?: { hasNextPage?: boolean };
    nodes?: GraphThread[];
  };
  comments?: { pageInfo?: { hasNextPage?: boolean }; nodes?: GraphComment[] };
}

const isBot = (author: GraphAuthor | null | undefined): boolean => author?.__typename === 'Bot';
const loginOf = (comment: GraphComment | undefined): string => comment?.author?.login ?? '';

const isRunReply = (comment: GraphComment | undefined): boolean => (comment?.body ?? '').trimEnd().endsWith('<!-- codagent-reply -->');

/** A thread's comments without the finding bot's trailing acks. */
function significantComments(comments: GraphComment[]): GraphComment[] {
  const findingAuthor = loginOf(comments[0]);
  if (!isBot(comments[0]?.author)) return comments;
  let end = comments.length;
  while (end > 1 && isBot(comments[end - 1]?.author) && loginOf(comments[end - 1]) === findingAuthor && !isRunReply(comments[end - 1])) end -= 1;
  return comments.slice(0, end);
}

/** Whether the latest significant comment is a marked run reply or another bot reply. */
function isDeferred(significant: GraphComment[], findingAuthor: string, _prAuthor: string): boolean {
  const latest = significant.at(-1);
  if (latest === undefined) return false;
  if (isRunReply(latest)) return true;
  if (isBot(latest.author)) return significant.length > 1 && loginOf(latest) !== findingAuthor;
  return false;
}

function threadEntry(first: GraphComment | undefined): Thread {
  return {
    file: first?.path ?? '',
    line: first?.line ?? first?.originalLine ?? null,
    author: first?.author?.login ?? 'unknown',
    body: first?.body ?? '',
  };
}

const asComment = (comment: GraphComment): Comment => ({
  author: comment.author?.login ?? 'unknown',
  body: comment.body ?? '',
});

/**
 * Classifies the PR's comments. An unresolved thread is deferred, and does not block, when
 * the latest significant comment (after dropping the finding bot's trailing acks) is from
 * a marked run reply, or from a different bot than the one that raised it.
 */
export function classifyComments(pr: GraphPullRequest, prAuthorLogin = ''): PrComments {
  const prAuthor = prAuthorLogin || pr.author?.login || '';
  const unresolvedThreads: Thread[] = [];
  const deferredThreads: Thread[] = [];
  for (const thread of pr.reviewThreads?.nodes ?? []) {
    if (thread.isResolved) continue;
    const comments = thread.comments?.nodes ?? [];
    const findingAuthor = loginOf(comments[0]);
    const deferred = isDeferred(significantComments(comments), findingAuthor, prAuthor);
    (deferred ? deferredThreads : unresolvedThreads).push(threadEntry(comments[0]));
  }
  const topLevel = (pr.comments?.nodes ?? []).filter(comment => !isRunReply(comment));
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
          id
          isResolved
          comments(first: 100) { pageInfo { hasNextPage endCursor } nodes { author { __typename login } body path line originalLine } }
        }
      }
      comments(first: 100) {
        pageInfo { hasNextPage }
        nodes { author { __typename login } body }
      }
    }
  }
}`;

const THREAD_QUERY = `query($threadId: ID!, $cursor: String!) {
  node(id: $threadId) { ... on PullRequestReviewThread {
    comments(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { author { __typename login } body path line originalLine }
    }
  } }
}`;
function readThreadPage(exec: Exec, threadId: string, cursor: string): CommentPage | string {
  const result = exec('gh', ['api', 'graphql', '-f', `query=${THREAD_QUERY}`, '-f', `threadId=${threadId}`, '-f', `cursor=${cursor}`]);
  if (result.status !== 0) return `failed to fetch review-thread replies: ${result.stderr.trim()}`;
  const response = JSON.parse(result.stdout) as { data?: { node?: { comments?: CommentPage } } };
  const page = response.data?.node?.comments;
  return page?.nodes && page.pageInfo ? page : 'review-thread reply page is missing';
}
function completeThread(exec: Exec, thread: GraphThread): string | undefined {
  let page = thread.comments; const seen = new Set<string>();
  const comments = [...(page?.nodes ?? [])];
  while (page?.pageInfo?.hasNextPage) {
    const cursor = page.pageInfo.endCursor;
    if (!(thread.id && cursor ) || seen.has(cursor)) return 'cannot paginate review-thread comments: missing or repeated cursor';
    seen.add(cursor);
    const fetched = readThreadPage(exec, thread.id, cursor);
    if (typeof fetched === 'string') return fetched;
    page = fetched;
    comments.push(...(page.nodes ?? []));
  }
  thread.comments = { nodes: comments };
  return undefined;
}
function completeThreads(exec: Exec, pr: GraphPullRequest): string | undefined {
  for (const thread of pr.reviewThreads?.nodes ?? []) {
    if (thread.isResolved) continue;
    const problem = completeThread(exec, thread);
    if (problem) return problem;
  }
  return undefined;
}

/** The PR's classified comments, or a problem message when they cannot all be read. */
export function fetchComments(exec: Exec, owner: string, repo: string, number: number): PrComments | string {
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
  const unread = completeThreads(exec, pr);
  return unread ?? classifyComments(pr);
}
