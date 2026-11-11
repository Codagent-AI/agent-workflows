import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  type CiResult,
  type PrComments,
  blockingReviews,
  classifyComments,
  failedRunIds,
  finalStatus,
  renderReport,
  waitForCi,
} from '../.archon/workflows/codagent/.shared/lib/ci.ts';
import { type FakeResponse, type FakeRule, type Sandbox, createSandbox, reply, rule } from './helpers.ts';

let box: Sandbox;
beforeEach(() => {
  box = createSandbox();
});
afterEach(() => box.dispose());

// ---------------------------------------------------------------------------------------
// classifyComments (get-pr-comments_test.sh)

type Author = { login: string; __typename: 'User' | 'Bot' } | null;
const user = (login: string): Author => ({ login, __typename: 'User' });
const bot = (login: string): Author => ({ login, __typename: 'Bot' });

interface RawComment {
  author: Author;
  body: string;
  path?: string;
  line?: number | null;
  originalLine?: number | null;
}
const inline = (author: Author, body: string, path = 'openspec/foo.md', line = 3): RawComment => ({
  author,
  body,
  path,
  line,
  originalLine: null,
});
const pr = (options: { threads?: { isResolved: boolean; comments: RawComment[] }[]; comments?: RawComment[] }) => ({
  author: user('pr-author'),
  reviewThreads: { nodes: (options.threads ?? []).map(t => ({ isResolved: t.isResolved, comments: { nodes: t.comments } })) },
  comments: { nodes: options.comments ?? [] },
});

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

// ---------------------------------------------------------------------------------------
// Small pure helpers

describe('blockingReviews', () => {
  const review = (login: string, state: string, body = '') => ({ user: { login }, state, body });

  test('keeps the latest non-pending review per reviewer that requests changes', () => {
    expect(
      blockingReviews([
        review('alice', 'CHANGES_REQUESTED', 'fix it'),
        review('bob', 'CHANGES_REQUESTED', 'no'),
        review('bob', 'APPROVED'),
        review('carol', 'COMMENTED'),
      ])
    ).toEqual([{ login: 'alice', state: 'CHANGES_REQUESTED', body: 'fix it' }]);
  });

  test('a pending review does not replace an earlier one', () => {
    expect(blockingReviews([review('alice', 'CHANGES_REQUESTED', 'fix'), review('alice', 'PENDING')])).toHaveLength(1);
  });

  test('a later request for changes replaces an approval', () => {
    expect(blockingReviews([review('alice', 'APPROVED'), review('alice', 'CHANGES_REQUESTED', 'now no')])).toEqual([
      { login: 'alice', state: 'CHANGES_REQUESTED', body: 'now no' },
    ]);
  });
});

describe('failedRunIds', () => {
  test('extracts distinct run ids from check links', () => {
    const link = (id: string, job: string) => `https://github.com/o/r/actions/runs/${id}/job/${job}`;
    expect(
      failedRunIds([
        { name: 'a', state: 'FAILURE', link: link('123', '1') },
        { name: 'b', state: 'FAILURE', link: link('123', '2') },
        { name: 'c', state: 'FAILURE', link: link('456', '3') },
        { name: 'd', state: 'FAILURE', link: 'https://example.com/other' },
        { name: 'e', state: 'FAILURE' },
      ])
    ).toEqual(['123', '456']);
  });
});

describe('finalStatus', () => {
  const base = { failedChecks: [], blockingReviews: [], pendingChecks: [], mergeable: 'MERGEABLE' };
  const check = { name: 'ci', state: 'FAILURE' };
  const comments = (hasComments: boolean): PrComments => ({
    hasComments,
    unresolvedThreads: [],
    deferredThreads: [],
    issueComments: [],
    informationalBotComments: [],
  });

  test('passed when nothing is wrong', () => {
    expect(finalStatus(base, comments(false))).toBe('passed');
    expect(finalStatus(base, undefined)).toBe('passed');
  });

  test('a failed check, blocking review or conflict fails, even with comments', () => {
    expect(finalStatus({ ...base, failedChecks: [check] }, comments(true))).toBe('failed');
    expect(finalStatus({ ...base, blockingReviews: [{ login: 'a', state: 'CHANGES_REQUESTED', body: '' }] }, undefined)).toBe('failed');
    expect(finalStatus({ ...base, mergeable: 'CONFLICTING' }, undefined)).toBe('failed');
  });

  test('comments beat pending', () => {
    expect(finalStatus({ ...base, pendingChecks: [check] }, comments(true))).toBe('comments');
  });

  test('pending checks or an unknown mergeable state are pending', () => {
    expect(finalStatus({ ...base, pendingChecks: [check] }, comments(false))).toBe('pending');
    expect(finalStatus({ ...base, mergeable: 'UNKNOWN' }, comments(false))).toBe('pending');
  });
});

// ---------------------------------------------------------------------------------------
// waitForCi (check-ci_test.sh)

const GREEN = '[{"name":"CodeRabbit","state":"SUCCESS","bucket":"pass","link":"https://example.com"}]';
const EMPTY_GRAPH = JSON.stringify({ data: { repository: { pullRequest: { author: user('pr-author'), reviewThreads: { nodes: [] }, comments: { nodes: [] } } } } });

interface Scenario {
  mergeable: string;
  head?: string;
  base?: string;
  checks?: FakeResponse | string;
  reviews?: string;
  graph?: FakeResponse | string;
  extra?: FakeRule[];
}

function installGh(scenario: Scenario): void {
  const view = JSON.stringify({
    number: 86,
    url: 'https://github.com/owner/repo/pull/86',
    headRefName: 'branch',
    headRefOid: scenario.head ?? 'abc123',
    baseRefOid: scenario.base ?? 'def456',
    mergeable: scenario.mergeable,
  });
  const checks = scenario.checks ?? GREEN;
  box.fake('gh', [
    rule(['pr', 'view', '--json', 'number,url,headRefOid,baseRefOid,mergeable'], reply(view)),
    rule(['pr', 'view', '--json', 'mergeable,baseRefOid'], reply(view)),
    rule(['pr', 'view', '--json', 'headRefOid'], reply(view)),
    rule(['repo', 'view'], reply('{"owner":{"login":"owner"},"name":"repo"}')),
    rule(['pr', 'checks'], typeof checks === 'string' ? reply(checks) : checks),
    rule(['api', '--paginate'], reply(scenario.reviews ?? '')),
    rule(['api', 'graphql'], typeof scenario.graph === 'object' ? scenario.graph : reply(scenario.graph ?? EMPTY_GRAPH)),
    ...(scenario.extra ?? []),
  ]);
}

function wait(maxMinutes = 1, intervalSeconds = 30) {
  let clock = 0;
  const waits: number[] = [];
  const result = waitForCi(
    box.exec,
    ms => {
      waits.push(ms);
      clock += ms;
    },
    { maxMinutes, intervalSeconds, now: () => clock }
  );
  return { result, waits };
}

describe('waitForCi', () => {
  test('CONFLICTING with green checks fails and lists the conflicting files', () => {
    const base = box.commitFix('base\n');
    box.git('checkout', '-q', '-b', 'topic', 'HEAD~1');
    const head = box.commitFix('topic\n');
    installGh({ mergeable: 'CONFLICTING', head, base });
    const { result, waits } = wait();
    expect(result.status).toBe('failed');
    expect(result.mergeable).toBe('CONFLICTING');
    expect(result.conflictingFiles).toEqual(['file.txt']);
    expect(waits).toEqual([]);
  });

  test('UNKNOWN with green checks is not passed and waits for the deadline', () => {
    installGh({ mergeable: 'UNKNOWN' });
    const { result, waits } = wait(1, 30);
    expect(result.status).not.toBe('passed');
    expect(result.status).toBe('pending');
    expect(result.mergeable).toBe('UNKNOWN');
    expect(waits).toEqual([30_000, 30_000]);
  });

  test('MERGEABLE with green checks passes at once', () => {
    installGh({ mergeable: 'MERGEABLE' });
    const { result, waits } = wait();
    expect(result.status).toBe('passed');
    expect(result.mergeable).toBe('MERGEABLE');
    expect(result.hadChecks).toBe(true);
    expect(result.passedChecks).toHaveLength(1);
    expect(result.prUrl).toBe('https://github.com/owner/repo/pull/86');
    expect(waits).toEqual([]);
  });

  test('UNKNOWN with no checks is pending', () => {
    installGh({ mergeable: 'UNKNOWN', checks: '[]' });
    const { result } = wait();
    expect(result.status).toBe('pending');
    expect(result.mergeable).toBe('UNKNOWN');
    expect(result.hadChecks).toBe(false);
  });

  test('CONFLICTING without local git objects has no conflicting files', () => {
    installGh({ mergeable: 'CONFLICTING' });
    const { result } = wait();
    expect(result.status).toBe('failed');
    expect(result.conflictingFiles).toEqual([]);
  });

  test('a failed check fails and fetches the failed run log', () => {
    const failed = '[{"name":"build","state":"FAILURE","bucket":"fail","link":"https://github.com/o/r/actions/runs/555/job/1"}]';
    installGh({
      mergeable: 'MERGEABLE',
      checks: failed,
      extra: [rule(['run', 'view', '555', '--log-failed'], reply('error: build broke\n'))],
    });
    const { result } = wait();
    expect(result.status).toBe('failed');
    expect(result.failedChecks.map(check => check.name)).toEqual(['build']);
    expect(result.failedLogs).toEqual([{ runId: '555', log: 'error: build broke\n' }]);
  });

  test('a pending check keeps polling until the deadline', () => {
    installGh({ mergeable: 'MERGEABLE', checks: '[{"name":"slow","state":"PENDING","bucket":"pending"}]' });
    const { result, waits } = wait(1, 30);
    expect(result.status).toBe('pending');
    expect(result.pendingChecks).toHaveLength(1);
    expect(waits).toEqual([30_000, 30_000]);
    expect(result.elapsedMinutes).toBe(1);
  });

  test('a blocking review fails', () => {
    installGh({
      mergeable: 'MERGEABLE',
      reviews: '{"user":{"login":"alice"},"state":"CHANGES_REQUESTED","body":"fix it"}\n',
    });
    const { result } = wait();
    expect(result.status).toBe('failed');
    expect(result.blockingReviews).toEqual([{ login: 'alice', state: 'CHANGES_REQUESTED', body: 'fix it' }]);
  });

  test('"no checks reported" is a valid empty state', () => {
    installGh({ mergeable: 'MERGEABLE', checks: { status: 1, stderr: 'no checks reported on the branch\n' } });
    const { result } = wait();
    expect(result.status).toBe('passed');
    expect(result.hadChecks).toBe(false);
  });

  test('another pr checks failure is an error', () => {
    installGh({ mergeable: 'MERGEABLE', checks: { status: 1, stderr: 'rate limited\n' } });
    const { result } = wait();
    expect(result.status).toBe('error');
    expect(result.error).toContain('failed to fetch PR checks: rate limited');
  });

  test('a human PR comment makes green CI report comments', () => {
    const graph = JSON.stringify({
      data: { repository: { pullRequest: pr({ comments: [{ author: user('reviewer'), body: 'Please update this.' }] }) } },
    });
    installGh({ mergeable: 'MERGEABLE', graph });
    const { result } = wait();
    expect(result.status).toBe('comments');
    expect(result.comments?.issueComments).toEqual([{ author: 'reviewer', body: 'Please update this.' }]);
  });

  test('requests the comment query with author type names', () => {
    installGh({ mergeable: 'MERGEABLE' });
    wait();
    const graphql = box.calls('gh').find(call => call.args[1] === 'graphql');
    expect(graphql?.args.join(' ')).toContain('__typename');
    expect(graphql?.args).toContain('owner=owner');
    expect(graphql?.args).toContain('prNumber=86');
  });

  test.each(['reviewThreads', 'comments'])('more than one page of %s is an error, not passed', field => {
    const page = { reviewThreads: { nodes: [] }, comments: { nodes: [] } } as Record<string, object>;
    page[field] = { pageInfo: { hasNextPage: true }, nodes: [] };
    const graph = JSON.stringify({ data: { repository: { pullRequest: { author: user('pr-author'), ...page } } } });
    installGh({ mergeable: 'MERGEABLE', graph });
    const { result } = wait();
    expect(result.status).toBe('error');
    expect(result.error).toContain('more than 100 review threads or top-level comments');
  });

  test('a failed comment fetch is an error', () => {
    installGh({ mergeable: 'MERGEABLE', graph: { status: 1, stderr: 'graphql down\n' } });
    const { result } = wait();
    expect(result.status).toBe('error');
    expect(result.error).toBe('failed to fetch PR comments: graphql down');
  });

  test('head is not moved when local HEAD and the PR head agree', () => {
    installGh({ mergeable: 'MERGEABLE', head: box.head() });
    expect(wait().result.headMoved).toBe(false);
  });

  test('head is moved when local HEAD differs from the PR head', () => {
    installGh({ mergeable: 'MERGEABLE', head: '0123456789012345678901234567890123456789' });
    const { result } = wait();
    expect(result.headSha).toBe('0123456789012345678901234567890123456789');
    expect(result.headMoved).toBe(true);
  });

  test('no PR for the branch is an error', () => {
    box.fake('gh', [rule(['pr', 'view'], reply('', 1, 'no pull requests found'))]);
    const { result } = wait();
    expect(result.status).toBe('error');
    expect(result.error).toBe('no PR found for the current branch');
  });

  test('a failed repository lookup is an error', () => {
    box.fake('gh', [
      rule(['pr', 'view'], reply(JSON.stringify({ number: 1, url: 'u', headRefOid: 'abc', mergeable: 'MERGEABLE' }))),
      rule(['repo', 'view'], reply('', 1, 'denied')),
    ]);
    expect(wait().result.error).toBe('failed to fetch repository info');
  });
});

// ---------------------------------------------------------------------------------------
// renderReport

describe('renderReport', () => {
  const base = (): CiResult => ({
    status: 'passed',
    error: '',
    prUrl: 'https://github.com/o/r/pull/1',
    headSha: 'abc123',
    headMoved: false,
    hadChecks: true,
    failedChecks: [],
    passedChecks: [],
    pendingChecks: [],
    blockingReviews: [],
    failedLogs: [],
    mergeable: 'MERGEABLE',
    conflictingFiles: [],
    comments: undefined,
    elapsedMinutes: 2,
  });

  test('a green report has the header lines and passing checks', () => {
    const text = renderReport({ ...base(), passedChecks: [{ name: 'build', state: 'SUCCESS' }] });
    expect(text).toContain('## CI Status: passed');
    expect(text).toContain('**PR:** https://github.com/o/r/pull/1');
    expect(text).toContain('**Head:** abc123\n');
    expect(text).toContain('**Elapsed:** ~2 minutes');
    expect(text).toContain('### Passing Checks\n- build (SUCCESS)');
    expect(text).not.toContain('### Failed Checks');
    expect(text.endsWith('\n')).toBe(true);
  });

  test('a failed check shows its link and log', () => {
    const link = 'https://github.com/o/r/actions/runs/9/job/1';
    const text = renderReport({
      ...base(),
      status: 'failed',
      failedChecks: [{ name: 'build', state: 'FAILURE', link }],
      failedLogs: [{ runId: '9', log: 'boom' }],
    });
    expect(text).toContain('### Failed Checks');
    expect(text).toContain(`- **build** (FAILURE)\n  Link: ${link}`);
    expect(text).toContain('  Logs:\n  ```\nboom\n  ```');
  });

  test('conflicts, blocking reviews and moved head are reported', () => {
    const text = renderReport({
      ...base(),
      status: 'failed',
      headMoved: true,
      conflictingFiles: ['a.txt'],
      blockingReviews: [{ login: 'alice', state: 'CHANGES_REQUESTED', body: 'fix it' }],
    });
    expect(text).toContain('(local HEAD or the PR head has since moved)');
    expect(text).toContain('### Merge Conflicts\n- `a.txt`');
    expect(text).toContain('### Blocking Reviews\n- **alice**: fix it');
  });

  test('comments, deferred threads and informational bot comments get their own sections', () => {
    const thread = { file: 'a.ts', line: 4, author: 'bot[bot]', body: 'Unused' };
    const text = renderReport({
      ...base(),
      status: 'comments',
      comments: {
        hasComments: true,
        unresolvedThreads: [thread],
        deferredThreads: [{ ...thread, line: null, body: 'Later' }],
        issueComments: [{ author: 'reviewer', body: 'Please update this.' }],
        informationalBotComments: [{ author: 'qodo[bot]', body: 'Summary' }],
      },
    });
    expect(text).toContain('### PR Comments\n- **bot[bot]** on `a.ts` line 4: Unused');
    expect(text).toContain('- **reviewer** (issue comment): Please update this.');
    expect(text).toContain('### Deferred Threads\n- **bot[bot]** on `a.ts` line ?: Later');
    expect(text).toContain('### Informational Bot Comments\n- **qodo[bot]**: Summary');
  });

  test('says when no checks are reported, and shows an error', () => {
    expect(renderReport({ ...base(), hadChecks: false })).toContain('No CI checks are configured or reported');
    const errored = renderReport({ ...base(), status: 'error', error: 'no PR found', hadChecks: false, prUrl: '', headSha: '' });
    expect(errored).toContain('**Error:** no PR found');
    expect(errored).toContain('**PR:** unknown');
    expect(errored).not.toContain('No CI checks are configured');
  });

  test('still running checks are listed', () => {
    const text = renderReport({ ...base(), status: 'pending', pendingChecks: [{ name: 'slow', state: 'PENDING' }] });
    expect(text).toContain('### Still Running\n- slow (PENDING)');
  });
});
