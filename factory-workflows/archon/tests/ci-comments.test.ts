import { describe, expect, test } from 'bun:test';

import { classifyComments, fetchComments } from '../.archon/workflows/codagent/.shared/lib/ci-comments.ts';
import { bot, inline, pr, user, createSandbox, rule, reply } from './helpers.ts';

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

  test('the pull request author own comment counts', () => {
    const result = classifyComments(pr({ comments: [{ author: user('pr-author'), body: 'Context from the author' }] }), 'pr-author');
    expect(result).toMatchObject({ hasComments: true, issueComments: [{ author: 'pr-author', body: 'Context from the author' }], informationalBotComments: [] });
  });

  test('the author is read from the pull request when not given', () => {
    const result = classifyComments(pr({ comments: [{ author: user('pr-author'), body: 'Context' }] }));
    expect(result.issueComments).toEqual([{ author: 'pr-author', body: 'Context' }]);
  });

  test('a comment with a missing author is a human comment from unknown', () => {
    const result = classifyComments(pr({ comments: [{ author: null, body: 'Comment from a deleted account' }] }), 'pr-author');
    expect(result.hasComments).toBe(true);
    expect(result.issueComments).toEqual([{ author: 'unknown', body: 'Comment from a deleted account' }]);
  });

  const finding = inline(bot('coderabbitai[bot]'), 'Unused export');
  const deferralByAuthor = inline(user('pr-author'), 'Out of scope — leaving unresolved.');
  const ack = inline(bot('coderabbitai[bot]'), 'Acknowledged.');

  test('an unmarked author reply followed by bot ack remains actionable', () => {
    const result = classifyComments(pr({ threads: [{ isResolved: false, comments: [finding, deferralByAuthor, ack] }] }), 'pr-author');
    expect(result.hasComments).toBe(true);
    expect(result.unresolvedThreads).toHaveLength(1);
    expect(result.deferredThreads).toEqual([]);
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

test('INT-013 marked replies are excluded and latest marked thread replies defer', () => {
  const marked = { author: user('pr-author'), body: 'Leaving this for review.\n<!-- codagent-reply -->' };
  const result = classifyComments(pr({ comments: [marked], threads: [{ isResolved: false, comments: [inline(user('reviewer'), 'fix'), marked] }] }));
  expect(result.issueComments).toEqual([]); expect(result.deferredThreads).toHaveLength(1); expect(result.hasComments).toBe(false);
});

test('INT-013 marked bot replies defer even when bot identity equals the finding author', () => {
  const actor=bot('run-bot');
  const result=classifyComments(pr({threads:[{isResolved:false,comments:[inline(actor,'finding'),inline(actor,'reply\n<!-- codagent-reply -->')]}]}));
  expect(result.deferredThreads).toHaveLength(1);expect(result.hasComments).toBe(false);
});
test('INT-013 paginated thread replies include a human objection after a marked tenth reply',()=>{
  const box=createSandbox();
  try{
    const comments=Array.from({length:10},(_,i)=>inline(user('pr-author'),i===9?'run reply\n<!-- codagent-reply -->':`comment ${i}`));
    const first={data:{repository:{pullRequest:{reviewThreads:{nodes:[{id:'thread',isResolved:false,comments:{nodes:comments,pageInfo:{hasNextPage:true,endCursor:'page-1'}}}]},comments:{nodes:[]}}}}};
    const next={data:{node:{comments:{nodes:[inline(user('reviewer'),'Still a defect after the run reply')],pageInfo:{hasNextPage:false,endCursor:'page-2'}}}}};
    box.fake('gh',[rule(['api','graphql'],reply(JSON.stringify(first)),reply(JSON.stringify(next)))]);
    const result=fetchComments(box.exec,'owner','repo',7);expect(typeof result).not.toBe('string');
    if(typeof result==='string')throw new Error(result);
    expect(result.hasComments).toBe(true);expect(result.unresolvedThreads).toHaveLength(1);expect(result.deferredThreads).toEqual([]);
    expect(box.calls('gh')).toHaveLength(2);expect(box.calls('gh')[1].args).toContain('cursor=page-1');
  }finally{box.dispose();}
});
test.each(['missing cursor','read failed'])('INT-013 incomplete thread pagination %s cannot pass',cause=>{
  const box=createSandbox();
  try{
    const first={data:{repository:{pullRequest:{reviewThreads:{nodes:[{id:'thread',isResolved:false,comments:{nodes:[inline(user('author'),'reply\n<!-- codagent-reply -->')],pageInfo:{hasNextPage:true,endCursor:cause==='missing cursor'?null:'next'}}}]}}}}};
    box.fake('gh',[rule(['api','graphql'],reply(JSON.stringify(first)),reply('',1,'permission denied'))]);
    const result=fetchComments(box.exec,'owner','repo',7);expect(typeof result).toBe('string');if(cause==='read failed')expect(String(result)).toContain('permission denied');
  }finally{box.dispose();}
});
