import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  type Check,
  type CiResult,
  blockingReviews,
  finalStatus,
  waitForCi,
} from '../.archon/workflows/codagent/.shared/lib/ci.ts';
import type { PrComments } from '../.archon/workflows/codagent/.shared/lib/ci-comments.ts';
import { renderReport } from '../.archon/workflows/codagent/.shared/lib/ci-report.ts';
import {
  type FakeResponse,
  type FakeRule,
  type Sandbox,
  REPO,
  createSandbox,
  failed,
  pr,
  reply,
  ok,
  prView,
  requestOf,
  rule,
  user,
} from './helpers.ts';

let box: Sandbox;
beforeEach(() => {
  box = createSandbox();
});
afterEach(() => box.dispose());

const check = (name: string, state: string, detail = state): Check => ({
  name,
  state,
  detail,
  unit: { kind: 'check', id: '1', name },
});

/** A check as `checks.state` reports it. */
const unit = (name: string, state: string, nativeResult: string | null = null) => ({
  unit: { kind: 'check', id: `id-${name}`, name },
  nativeState: nativeResult === null ? 'in_progress' : 'completed',
  nativeResult,
  phase: nativeResult === null ? 'running' : 'completed',
  result: null,
  state,
});

// ---------------------------------------------------------------------------------------
// Small pure helpers

describe('blockingReviews', () => {
  const review = (login: string, state: string, body = '', extra: { createdAt?: string; kind?: string } = {}) => ({
    kind: extra.kind ?? 'review',
    author: { login },
    state,
    createdAt: extra.createdAt ?? '2026-01-01T00:00:00Z',
    body,
  });

  test('keeps the latest non-pending review per reviewer that requests changes', () => {
    expect(
      blockingReviews([
        review('alice', 'CHANGES_REQUESTED', 'fix it'),
        review('bob', 'CHANGES_REQUESTED', 'no'),
        review('bob', 'APPROVED', '', { createdAt: '2026-01-02T00:00:00Z' }),
        review('carol', 'COMMENTED'),
      ])
    ).toEqual([{ login: 'alice', state: 'CHANGES_REQUESTED', body: 'fix it' }]);
  });

  test('a pending review does not replace an earlier one', () => {
    expect(
      blockingReviews([review('alice', 'CHANGES_REQUESTED', 'fix'), review('alice', 'PENDING', '', { createdAt: '2026-01-03T00:00:00Z' })])
    ).toHaveLength(1);
  });

  test('a later request for changes replaces an approval, whatever the order listed', () => {
    expect(
      blockingReviews([
        review('alice', 'CHANGES_REQUESTED', 'now no', { createdAt: '2026-01-02T00:00:00Z' }),
        review('alice', 'APPROVED', '', { createdAt: '2026-01-01T00:00:00Z' }),
      ])
    ).toEqual([{ login: 'alice', state: 'CHANGES_REQUESTED', body: 'now no' }]);
  });

  test('a dismissed review does not block, and a diff comment is not a review', () => {
    expect(blockingReviews([review('alice', 'DISMISSED'), review('bob', 'CHANGES_REQUESTED', 'x', { kind: 'review_comment' })])).toEqual([]);
  });
});

describe('finalStatus', () => {
  const base = { failedChecks: [], blockingReviews: [], pendingChecks: [], mergeable: 'clean' };
  const failing = check('ci', 'red', 'failure');
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
    expect(finalStatus({ ...base, failedChecks: [failing] }, comments(true))).toBe('failed');
    expect(finalStatus({ ...base, blockingReviews: [{ login: 'a', state: 'CHANGES_REQUESTED', body: '' }] }, undefined)).toBe('failed');
    expect(finalStatus({ ...base, mergeable: 'conflict' }, undefined)).toBe('failed');
  });

  test('comments beat pending', () => {
    expect(finalStatus({ ...base, pendingChecks: [failing] }, comments(true))).toBe('comments');
  });

  test('pending checks or an unknown mergeable state are pending', () => {
    expect(finalStatus({ ...base, pendingChecks: [failing] }, comments(false))).toBe('pending');
    expect(finalStatus({ ...base, mergeable: 'unknown' }, comments(false))).toBe('pending');
  });
});

// ---------------------------------------------------------------------------------------
// waitForCi (check-ci_test.sh)

interface Scenario {
  mergeable: string;
  head?: string;
  base?: string;
  units?: unknown[];
  reviews?: unknown[];
  /** The gh GraphQL answer for comments and threads. */
  graph?: FakeResponse | string;
  /** Replaces the scenario's own answer to an operation. */
  overrides?: FakeRule[];
}

function installForge(scenario: Scenario) {
  const view = prView({ head_revision: scenario.head ?? 'abc123', base_revision: scenario.base ?? 'def456' });
  return box.forgeTools([
    ...(scenario.overrides ?? []),
    rule(['forge', 'pr.view'], ok('pr.view', view)),
    rule(['forge', 'pr.merge-state'], ok('pr.merge-state', { mergeable: scenario.mergeable })),
    rule(['forge', 'checks.state'], ok('checks.state', { units: scenario.units ?? [unit('CodeRabbit', 'green', 'success')] })),
    rule(['forge', 'pr.reviews'], ok('pr.reviews', { items: scenario.reviews ?? [] })),
  ]);
}

const EMPTY_GRAPH = JSON.stringify({ data: { repository: { pullRequest: pr({}) } } });

/** Comments and threads are the one read that stays on gh. */
function installGh(scenario: Scenario): void {
  const graph = scenario.graph ?? EMPTY_GRAPH;
  box.fake('gh', [rule(['api', 'graphql'], typeof graph === 'string' ? reply(graph) : graph)]);
}

function wait(scenario: Scenario, maxMinutes = 1, intervalSeconds = 30) {
  const tools = installForge(scenario);
  installGh(scenario);
  let clock = 0;
  const waits: number[] = [];
  const result = waitForCi(
    tools,
    ms => {
      waits.push(ms);
      clock += ms;
    },
    { maxMinutes, intervalSeconds, now: () => clock }
  );
  return { result, waits };
}

const refused = (message: string): FakeResponse => failed('forge_error', message);

describe('waitForCi', () => {
  test('a conflict with green checks fails and lists the conflicting files', () => {
    const base = box.commitFix('base\n');
    box.git('checkout', '-q', '-b', 'topic', 'HEAD~1');
    const head = box.commitFix('topic\n');
    const { result, waits } = wait({ mergeable: 'conflict', head, base });
    expect(result.status).toBe('failed');
    expect(result.mergeable).toBe('conflict');
    expect(result.conflictingFiles).toEqual(['file.txt']);
    expect(waits).toEqual([]);
  });

  test('an unknown mergeable state with green checks is not passed and waits for the deadline', () => {
    const { result, waits } = wait({ mergeable: 'unknown' }, 1, 30);
    expect(result.status).toBe('pending');
    expect(result.mergeable).toBe('unknown');
    expect(waits).toEqual([30_000, 30_000]);
  });

  test('a clean pull request with green checks passes at once', () => {
    const { result, waits } = wait({ mergeable: 'clean' });
    expect(result.status).toBe('passed');
    expect(result.mergeable).toBe('clean');
    expect(result.hadChecks).toBe(true);
    expect(result.passedChecks.map(entry => entry.name)).toEqual(['CodeRabbit']);
    expect(result.prUrl).toBe('https://github.com/owner/repo/pull/7');
    expect(waits).toEqual([]);
  });

  test('asks for everything about the pull request the branch resolves to', () => {
    wait({ mergeable: 'clean' });
    const requests = Object.fromEntries(
      box
        .calls('archon')
        .filter(call => call.args[1] !== 'resolve' && call.args[1] !== 'pr.view')
        .map(call => [call.args[1], requestOf(call)])
    );
    const ref = { repo: REPO, number: 7 };
    expect(requests).toEqual({
      'pr.merge-state': { ref },
      'checks.state': { ref },
      'pr.reviews': { ref },
    });
  });

  test('reads comments and threads with one gh GraphQL query that asks for the author type', () => {
    wait({ mergeable: 'clean' });
    const graphql = box.calls('gh').find(call => call.args[1] === 'graphql');
    expect(graphql?.args.join(' ')).toContain('__typename');
    expect(graphql?.args).toContain('owner=owner');
    expect(graphql?.args).toContain('repo=repo');
    expect(graphql?.args).toContain('prNumber=7');
    expect(box.calls('archon').some(call => call.args[1] === 'pr.threads' || call.args[1] === 'workitem.comments')).toBe(false);
  });

  test('an unknown mergeable state with no checks is pending', () => {
    const { result } = wait({ mergeable: 'unknown', units: [] });
    expect(result.status).toBe('pending');
    expect(result.hadChecks).toBe(false);
  });

  test('a conflict without local git objects has no conflicting files', () => {
    const { result } = wait({ mergeable: 'conflict' });
    expect(result.status).toBe('failed');
    expect(result.conflictingFiles).toEqual([]);
  });

  test('a failed check fails and fetches its log', () => {
    const logs = rule(
      ['forge', 'checks.logs'],
      ok('checks.logs', { log: { kind: 'text', text: 'error: build broke\n', truncated: false, totalBytes: 19 } })
    );
    const { result } = wait({ mergeable: 'clean', units: [unit('build', 'red', 'failure')], overrides: [logs] });
    expect(result.status).toBe('failed');
    expect(result.failedChecks.map(entry => entry.name)).toEqual(['build']);
    expect(result.failedLogs).toEqual([{ name: 'build', log: 'error: build broke\n' }]);
    const call = box.calls('archon').find(entry => entry.args[1] === 'checks.logs');
    expect(call && requestOf(call)).toEqual({ repo: REPO, unit: { kind: 'check', id: 'id-build', name: 'build' } });
  });

  test('a failed check with no log says why', () => {
    const logs = rule(['forge', 'checks.logs'], ok('checks.logs', { log: { kind: 'none', reason: 'log_unavailable' } }));
    const { result } = wait({ mergeable: 'clean', units: [unit('lint', 'red', 'failure')], overrides: [logs] });
    expect(result.failedLogs).toEqual([{ name: 'lint', log: 'no log (log_unavailable)' }]);
  });

  test('a failed log read is reported in place of the log', () => {
    const logs = rule(['forge', 'checks.logs'], refused('gone'));
    const { result } = wait({ mergeable: 'clean', units: [unit('lint', 'red', 'failure')], overrides: [logs] });
    expect(result.status).toBe('failed');
    expect(result.failedLogs[0].log).toBe('forge checks.logs failed (forge_error): gone');
  });

  test.each([
    ['pending', 'pending'],
    ['gated', 'gated'],
    ['unknown', 'unknown'],
  ])('a %s check keeps polling until the deadline', (_name, state) => {
    const { result, waits } = wait({ mergeable: 'clean', units: [unit('slow', state)] }, 1, 30);
    expect(result.status).toBe('pending');
    expect(result.pendingChecks).toHaveLength(1);
    expect(waits).toEqual([30_000, 30_000]);
    expect(result.elapsedMinutes).toBe(1);
  });

  test('a blocking review fails', () => {
    const reviews = [{ kind: 'review', author: { login: 'alice' }, state: 'CHANGES_REQUESTED', createdAt: null, body: 'fix it' }];
    const { result } = wait({ mergeable: 'clean', reviews });
    expect(result.status).toBe('failed');
    expect(result.blockingReviews).toEqual([{ login: 'alice', state: 'CHANGES_REQUESTED', body: 'fix it' }]);
  });

  test('a pull request with no checks is a valid empty state', () => {
    const { result } = wait({ mergeable: 'clean', units: [] });
    expect(result.status).toBe('passed');
    expect(result.hadChecks).toBe(false);
  });

  test.each([
    ['checks.state', 'failed to fetch PR checks: forge checks.state failed (forge_error): rate limited'],
    ['pr.reviews', 'failed to fetch PR reviews: forge pr.reviews failed (forge_error): rate limited'],
    ['pr.merge-state', 'failed to fetch PR merge state: forge pr.merge-state failed (forge_error): rate limited'],
  ])('a failed %s read is an error, not a pass', (op, want) => {
    const { result } = wait({ mergeable: 'clean', overrides: [rule(['forge', op], refused('rate limited'))] });
    expect(result.status).toBe('error');
    expect(result.error).toBe(want);
  });

  test('a human PR comment makes green CI report comments', () => {
    const graph = JSON.stringify({
      data: { repository: { pullRequest: pr({ comments: [{ author: user('reviewer'), body: 'Please update this.' }] }) } },
    });
    const { result } = wait({ mergeable: 'clean', graph });
    expect(result.status).toBe('comments');
    expect(result.comments?.issueComments).toEqual([{ author: 'reviewer', body: 'Please update this.' }]);
  });

  test.each(['reviewThreads', 'comments'])('more than one page of %s is an error, not passed', field => {
    const page = { reviewThreads: { nodes: [] }, comments: { nodes: [] } } as Record<string, object>;
    page[field] = { pageInfo: { hasNextPage: true }, nodes: [] };
    const graph = JSON.stringify({ data: { repository: { pullRequest: { author: user('pr-author'), ...page } } } });
    const { result } = wait({ mergeable: 'clean', graph });
    expect(result.status).toBe('error');
    expect(result.error).toContain('more than 100 review threads or top-level comments');
  });

  test('a failed comment fetch is an error', () => {
    const { result } = wait({ mergeable: 'clean', graph: { status: 1, stderr: 'graphql down\n' } });
    expect(result.status).toBe('error');
    expect(result.error).toBe('failed to fetch PR comments: graphql down');
  });

  test('head is not moved when local HEAD and the PR head agree', () => {
    expect(wait({ mergeable: 'clean', head: box.head() }).result.headMoved).toBe(false);
  });

  test('head is moved when local HEAD differs from the PR head', () => {
    const { result } = wait({ mergeable: 'clean', head: '0123456789012345678901234567890123456789' });
    expect(result.headSha).toBe('0123456789012345678901234567890123456789');
    expect(result.headMoved).toBe(true);
  });

  test('no PR for the branch is an error', () => {
    const { result } = wait({ mergeable: 'clean', overrides: [rule(['forge', 'pr.view'], ok('pr.view', null))] });
    expect(result.status).toBe('error');
    expect(result.error).toBe('no PR found for the current branch');
  });

  test('a failed lookup is an error that names the forge failure', () => {
    const { result } = wait({ mergeable: 'clean', overrides: [rule(['forge', 'pr.view'], failed('authorization', 'bad credentials'))] });
    expect(result.error).toBe('forge pr.view failed (authorization): bad credentials');
  });

  test('a pull request without a head revision is an error', () => {
    const view = ok('pr.view', prView({ head_revision: null }));
    expect(wait({ mergeable: 'clean', overrides: [rule(['forge', 'pr.view'], view)] }).result.error).toBe('the PR head SHA is missing');
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
    mergeable: 'clean',
    conflictingFiles: [],
    comments: undefined,
    elapsedMinutes: 2,
  });

  test('a green report has the header lines and passing checks', () => {
    const text = renderReport({ ...base(), passedChecks: [check('build', 'green', 'success')] });
    expect(text).toContain('## CI Status: passed');
    expect(text).toContain('**PR:** https://github.com/o/r/pull/1');
    expect(text).toContain('**Head:** abc123\n');
    expect(text).toContain('**Elapsed:** ~2 minutes');
    expect(text).toContain('### Passing Checks\n- build (success)');
    expect(text).not.toContain('### Failed Checks');
    expect(text.endsWith('\n')).toBe(true);
  });

  test('a failed check shows its log', () => {
    const text = renderReport({
      ...base(),
      status: 'failed',
      failedChecks: [check('build', 'red', 'failure')],
      failedLogs: [{ name: 'build', log: 'boom' }],
    });
    expect(text).toContain('### Failed Checks');
    expect(text).toContain('- **build** (failure)');
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
    const unresolved = { file: 'a.ts', line: 4, author: 'bot[bot]', body: 'Unused' };
    const text = renderReport({
      ...base(),
      status: 'comments',
      comments: {
        hasComments: true,
        unresolvedThreads: [unresolved],
        deferredThreads: [{ ...unresolved, line: null, body: 'Later' }],
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
    const text = renderReport({ ...base(), status: 'pending', pendingChecks: [check('slow', 'pending', 'in_progress')] });
    expect(text).toContain('### Still Running\n- slow (in_progress)');
  });
});
