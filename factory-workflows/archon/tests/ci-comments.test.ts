import { describe, expect, test } from 'bun:test';

import { classifyComments } from '../.archon/workflows/codagent/.shared/lib/ci-comments.ts';
import { bot, inline, pr, user } from './helpers.ts';

describe('classifyComments', () => {
  test('only bot comments are informational and do not count as comments', () => {
    const result = classifyComments(
      pr({ comments: [{ author: bot('qodo-merge-pro[bot]'), body: 'Analysis summary' }] }),
      'pr-author'
    );
    expect(result.hasComments).toBe(false);
    expect(result.issueComments).toEqual([]);
    expect(result.informationalBotComments).toEqual([{ author: 'qodo-merge-pro[bot]', body: 'Analysis summary' }]);
  });

  test('a human comment counts', () => {
    const result = classifyComments(pr({ comments: [{ author: user('reviewer'), body: 'Please update this.' }] }), 'pr-author');
    expect(result.hasComments).toBe(true);
    expect(result.issueComments).toEqual([{ author: 'reviewer', body: 'Please update this.' }]);
    expect(result.informationalBotComments).toEqual([]);
  });

  test('an unresolved bot thread blocks', () => {
    const result = classifyComments(
      pr({ threads: [{ isResolved: false, comments: [{ ...inline(bot('qodo-merge-pro[bot]'), 'Potential bug', 'script.sh', 12) }] }] }),
      'pr-author'
    );
    expect(result.hasComments).toBe(true);
    expect(result.unresolvedThreads).toEqual([{ file: 'script.sh', line: 12, author: 'qodo-merge-pro[bot]', body: 'Potential bug' }]);
    expect(result.deferredThreads).toEqual([]);
  });

  test('a resolved thread is ignored', () => {
    const result = classifyComments(pr({ threads: [{ isResolved: true, comments: [inline(user('reviewer'), 'Fixed')] }] }), 'pr-author');
    expect(result).toMatchObject({ hasComments: false, unresolvedThreads: [], deferredThreads: [] });
  });

  test('the pull request author own comment is dropped', () => {
    const result = classifyComments(pr({ comments: [{ author: user('pr-author'), body: 'Context from the author' }] }), 'pr-author');
    expect(result).toMatchObject({ hasComments: false, issueComments: [], informationalBotComments: [] });
  });

  test('the author is read from the pull request when not given', () => {
    const result = classifyComments(pr({ comments: [{ author: user('pr-author'), body: 'Context' }] }));
    expect(result.issueComments).toEqual([]);
  });

  test('a comment with a missing author is a human comment from unknown', () => {
    const result = classifyComments(pr({ comments: [{ author: null, body: 'Comment from a deleted account' }] }), 'pr-author');
    expect(result.hasComments).toBe(true);
    expect(result.issueComments).toEqual([{ author: 'unknown', body: 'Comment from a deleted account' }]);
  });

  const finding = inline(bot('coderabbitai[bot]'), 'Unused export');
  const deferralByAuthor = inline(user('pr-author'), 'Out of scope — leaving unresolved.');
  const ack = inline(bot('coderabbitai[bot]'), 'Acknowledged.');

  test('an author deferral followed by a bot ack defers the thread', () => {
    const result = classifyComments(pr({ threads: [{ isResolved: false, comments: [finding, deferralByAuthor, ack] }] }), 'pr-author');
    expect(result.hasComments).toBe(false);
    expect(result.unresolvedThreads).toEqual([]);
    expect(result.deferredThreads).toEqual([{ file: 'openspec/foo.md', line: 3, author: 'coderabbitai[bot]', body: 'Unused export' }]);
  });

  test('a later human reviewer reply keeps the thread unresolved', () => {
    const reviewer = inline(user('reviewer'), 'Please still fix this.');
    const result = classifyComments(
      pr({ threads: [{ isResolved: false, comments: [finding, deferralByAuthor, ack, reviewer] }] }),
      'pr-author'
    );
    expect(result.hasComments).toBe(true);
    expect(result.unresolvedThreads).toEqual([{ file: 'openspec/foo.md', line: 3, author: 'coderabbitai[bot]', body: 'Unused export' }]);
    expect(result.deferredThreads).toEqual([]);
  });

  test('a different bot deferral followed by the finding bot ack defers the thread', () => {
    const deferralByBot = inline(bot('codagent-ai[bot]'), 'Out of scope — leaving unresolved.');
    const result = classifyComments(pr({ threads: [{ isResolved: false, comments: [finding, deferralByBot, ack] }] }), 'pr-author');
    expect(result.hasComments).toBe(false);
    expect(result.unresolvedThreads).toEqual([]);
    expect(result.deferredThreads).toHaveLength(1);
  });

  test('a bot ack alone does not defer its own finding', () => {
    const result = classifyComments(pr({ threads: [{ isResolved: false, comments: [finding, ack] }] }), 'pr-author');
    expect(result.unresolvedThreads).toHaveLength(1);
    expect(result.deferredThreads).toEqual([]);
  });

  test('a thread comment falls back to originalLine and a missing path', () => {
    const result = classifyComments(
      pr({ threads: [{ isResolved: false, comments: [{ author: user('reviewer'), body: 'x', line: null, originalLine: 7 }] }] }),
      'pr-author'
    );
    expect(result.unresolvedThreads).toEqual([{ file: '', line: 7, author: 'reviewer', body: 'x' }]);
  });

  test('an empty pull request has no comments', () => {
    expect(classifyComments({})).toEqual({
      hasComments: false,
      unresolvedThreads: [],
      deferredThreads: [],
      issueComments: [],
      informationalBotComments: [],
    });
  });
});
