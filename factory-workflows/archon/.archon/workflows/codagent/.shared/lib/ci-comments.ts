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

interface GraphPullRequest {
  author?: GraphAuthor | null;
  reviewThreads?: {
    pageInfo?: { hasNextPage?: boolean };
    nodes?: { isResolved: boolean; comments?: { nodes?: GraphComment[] } }[];
  };
  comments?: { pageInfo?: { hasNextPage?: boolean }; nodes?: GraphComment[] };
}

const isBot = (author: GraphAuthor | null | undefined): boolean => author?.__typename === 'Bot';
const loginOf = (comment: GraphComment | undefined): string => comment?.author?.login ?? '';

/** A thread's comments without the finding bot's trailing acks. */
function significantComments(comments: GraphComment[]): GraphComment[] {
  const findingAuthor = loginOf(comments[0]);
  if (!isBot(comments[0]?.author)) return comments;
  let end = comments.length;
  while (end > 1 && isBot(comments[end - 1]?.author) && loginOf(comments[end - 1]) === findingAuthor) end -= 1;
  return comments.slice(0, end);
}

/** Whether the latest significant comment is from the PR author or from another bot. */
function isDeferred(significant: GraphComment[], findingAuthor: string, prAuthor: string): boolean {
  const latest = significant.at(-1);
  if (latest === undefined) return false;
  if (isBot(latest.author)) return significant.length > 1 && loginOf(latest) !== findingAuthor;
  return prAuthor !== '' && loginOf(latest) === prAuthor;
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
 * the PR author, or from a different bot than the one that raised it.
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
  const topLevel = (pr.comments?.nodes ?? []).filter(comment => prAuthor === '' || loginOf(comment) !== prAuthor);
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
  return classifyComments(pr);
}
