// The pull request's comments for the CI report: review threads and top-level comments,
// read through the forge and sorted into what blocks and what is informational.
import { type Forge, OPS } from './forge.ts';

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

/** A comment as the forge reports it: its author's login is null for a deleted account. */
export interface RawComment {
  author: { login: string | null } | null;
  body: string;
}

export interface RawThread {
  resolved: boolean;
  path: string | null;
  line: number | null;
  comments: RawComment[];
}

// GitHub names every app and bot account `<name>[bot]`; the forge reports no actor type.
const isBot = (comment: RawComment | undefined): boolean => loginOf(comment).endsWith('[bot]');
const loginOf = (comment: RawComment | undefined): string => comment?.author?.login ?? '';

/** A thread's comments without the finding bot's trailing acks. */
function significantComments(comments: RawComment[]): RawComment[] {
  const findingAuthor = loginOf(comments[0]);
  if (!isBot(comments[0])) return comments;
  let end = comments.length;
  while (end > 1 && isBot(comments[end - 1]) && loginOf(comments[end - 1]) === findingAuthor) end -= 1;
  return comments.slice(0, end);
}

/** Whether the latest significant comment is from the PR author or from another bot. */
function isDeferred(significant: RawComment[], findingAuthor: string, prAuthor: string): boolean {
  const latest = significant.at(-1);
  if (latest === undefined) return false;
  if (isBot(latest)) return significant.length > 1 && loginOf(latest) !== findingAuthor;
  return prAuthor !== '' && loginOf(latest) === prAuthor;
}

function threadEntry(thread: RawThread): Thread {
  const first = thread.comments[0];
  return {
    file: thread.path ?? '',
    line: thread.line,
    author: first?.author?.login ?? 'unknown',
    body: first?.body ?? '',
  };
}

const asComment = (comment: RawComment): Comment => ({
  author: comment.author?.login ?? 'unknown',
  body: comment.body ?? '',
});

/** What the forge reports about a pull request's conversation. */
export interface Conversation {
  /** The pull request author's login, empty when unknown. */
  prAuthor: string;
  threads: RawThread[];
  comments: RawComment[];
}

/**
 * Classifies the PR's comments. An unresolved thread is deferred, and does not block, when
 * the latest significant comment (after dropping the finding bot's trailing acks) is from
 * the PR author, or from a different bot than the one that raised it.
 */
export function classifyComments({ prAuthor, threads, comments }: Conversation): PrComments {
  const unresolvedThreads: Thread[] = [];
  const deferredThreads: Thread[] = [];
  for (const thread of threads) {
    if (thread.resolved) continue;
    const findingAuthor = loginOf(thread.comments[0]);
    const deferred = isDeferred(significantComments(thread.comments), findingAuthor, prAuthor);
    (deferred ? deferredThreads : unresolvedThreads).push(threadEntry(thread));
  }
  const topLevel = comments.filter(comment => prAuthor === '' || loginOf(comment) !== prAuthor);
  // Only explicit bot accounts are informational, so missing author metadata cannot hide feedback.
  const issueComments = topLevel.filter(comment => !isBot(comment)).map(asComment);
  const informationalBotComments = topLevel.filter(isBot).map(asComment);
  return {
    hasComments: unresolvedThreads.length + issueComments.length > 0,
    unresolvedThreads,
    deferredThreads,
    issueComments,
    informationalBotComments,
  };
}

/** The PR's classified comments, or a problem message when they cannot all be read. */
export function fetchComments(forge: Forge, ref: object, prAuthor: string): PrComments | string {
  const threads = forge.call<{ threads: RawThread[] }>(OPS.threads, { ref });
  if (!threads.ok) return `failed to fetch PR review threads: ${threads.problem}`;
  const comments = forge.call<{ comments: RawComment[] }>(OPS.comments, { subject: { kind: 'pr', ref } });
  if (!comments.ok) return `failed to fetch PR comments: ${comments.problem}`;
  return classifyComments({ prAuthor, threads: threads.value.threads, comments: comments.value.comments });
}
