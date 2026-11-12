import { describe, expect, test } from 'bun:test';

import { classifyComments } from '../.archon/workflows/codagent/.shared/lib/ci-comments.ts';
import { bot, inline, thread, user } from './helpers.ts';

const conversation = (options: { threads?: ReturnType<typeof thread>[]; comments?: ReturnType<typeof inline>[]; prAuthor?: string }) => ({
  prAuthor: options.prAuthor ?? 'pr-author',
  threads: options.threads ?? [],
  comments: options.comments ?? [],
});

describe('classifyComments', () => {
  test('only bot comments are informational and do not count as comments', () => {
    const result = classifyComments(conversation({ comments: [inline(bot('qodo-merge-pro'), 'Analysis summary')] }));
    expect(result.hasComments).toBe(false);
    expect(result.issueComments).toEqual([]);
    expect(result.informationalBotComments).toEqual([{ author: 'qodo-merge-pro[bot]', body: 'Analysis summary' }]);
  });

  test('a human comment counts', () => {
    const result = classifyComments(conversation({ comments: [inline(user('reviewer'), 'Please update this.')] }));
    expect(result.hasComments).toBe(true);
    expect(result.issueComments).toEqual([{ author: 'reviewer', body: 'Please update this.' }]);
    expect(result.informationalBotComments).toEqual([]);
  });

  test('an unresolved bot thread blocks', () => {
    const result = classifyComments(
      conversation({ threads: [thread(false, [inline(bot('qodo-merge-pro'), 'Potential bug')], 'script.sh', 12)] })
    );
    expect(result.hasComments).toBe(true);
    expect(result.unresolvedThreads).toEqual([{ file: 'script.sh', line: 12, author: 'qodo-merge-pro[bot]', body: 'Potential bug' }]);
    expect(result.deferredThreads).toEqual([]);
  });

  test('a resolved thread is ignored', () => {
    const result = classifyComments(conversation({ threads: [thread(true, [inline(user('reviewer'), 'Fixed')])] }));
    expect(result).toMatchObject({ hasComments: false, unresolvedThreads: [], deferredThreads: [] });
  });

  test('the pull request author own comment is dropped', () => {
    const result = classifyComments(conversation({ comments: [inline(user('pr-author'), 'Context from the author')] }));
    expect(result).toMatchObject({ hasComments: false, issueComments: [], informationalBotComments: [] });
  });

  test('with no known author every comment counts', () => {
    const result = classifyComments(conversation({ prAuthor: '', comments: [inline(user('pr-author'), 'Context')] }));
    expect(result.issueComments).toHaveLength(1);
  });

  test('a comment with a missing author is a human comment from unknown', () => {
    const result = classifyComments(conversation({ comments: [inline(null, 'Comment from a deleted account')] }));
    expect(result.hasComments).toBe(true);
    expect(result.issueComments).toEqual([{ author: 'unknown', body: 'Comment from a deleted account' }]);
  });

  const finding = inline(bot('coderabbitai'), 'Unused export');
  const deferralByAuthor = inline(user('pr-author'), 'Out of scope — leaving unresolved.');
  const ack = inline(bot('coderabbitai'), 'Acknowledged.');
  const finding1 = { file: 'openspec/foo.md', line: 3, author: 'coderabbitai[bot]', body: 'Unused export' };

  test('an author deferral followed by a bot ack defers the thread', () => {
    const result = classifyComments(conversation({ threads: [thread(false, [finding, deferralByAuthor, ack])] }));
    expect(result.hasComments).toBe(false);
    expect(result.unresolvedThreads).toEqual([]);
    expect(result.deferredThreads).toEqual([finding1]);
  });

  test('a later human reviewer reply keeps the thread unresolved', () => {
    const reviewer = inline(user('reviewer'), 'Please still fix this.');
    const result = classifyComments(conversation({ threads: [thread(false, [finding, deferralByAuthor, ack, reviewer])] }));
    expect(result.hasComments).toBe(true);
    expect(result.unresolvedThreads).toEqual([finding1]);
    expect(result.deferredThreads).toEqual([]);
  });

  test('a different bot deferral followed by the finding bot ack defers the thread', () => {
    const deferralByBot = inline(bot('codagent-ai'), 'Out of scope — leaving unresolved.');
    const result = classifyComments(conversation({ threads: [thread(false, [finding, deferralByBot, ack])] }));
    expect(result.hasComments).toBe(false);
    expect(result.unresolvedThreads).toEqual([]);
    expect(result.deferredThreads).toHaveLength(1);
  });

  test('a bot ack alone does not defer its own finding', () => {
    const result = classifyComments(conversation({ threads: [thread(false, [finding, ack])] }));
    expect(result.unresolvedThreads).toHaveLength(1);
    expect(result.deferredThreads).toEqual([]);
  });

  test('a thread the forge gives no path or line for reports an empty file and no line', () => {
    const result = classifyComments(conversation({ threads: [{ resolved: false, path: null, line: null, comments: [inline(user('reviewer'), 'x')] }] }));
    expect(result.unresolvedThreads).toEqual([{ file: '', line: null, author: 'reviewer', body: 'x' }]);
  });

  test('an empty conversation has no comments', () => {
    expect(classifyComments(conversation({}))).toEqual({
      hasComments: false,
      unresolvedThreads: [],
      deferredThreads: [],
      issueComments: [],
      informationalBotComments: [],
    });
  });
});
