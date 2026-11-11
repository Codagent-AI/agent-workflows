import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  BODY_END,
  BODY_START,
  acceptancePush,
  checkDraftPr,
  markBlock,
  spliceBody,
  updateGeneratedBody,
  updatePrBody,
} from '../.archon/workflows/codagent/.shared/lib/pull-request.ts';
import { type Sandbox, createSandbox, recordingSleep, reply, rule } from './helpers.ts';

let box: Sandbox;
beforeEach(() => {
  box = createSandbox();
});
afterEach(() => box.dispose());

const STALE = '0123456789abcdef0123456789abcdef01234567';

const prJson = (head: string, draft: boolean): string =>
  JSON.stringify({
    number: 1,
    url: 'https://example.test/pr/1',
    state: 'OPEN',
    isDraft: draft,
    baseRefName: 'main',
    headRefOid: head,
  });
const prList = (...prs: string[]): string => `[${prs.join(',')}]`;

describe('checkDraftPr (check-draft-pr.sh)', () => {
  const check = (attempts = 1, interval = 0) => {
    const { sleep, waits } = recordingSleep();
    return { result: checkDraftPr(box.exec, sleep, attempts, interval), waits };
  };

  test('returns the URL when the draft pull request is at local HEAD', () => {
    box.fake('gh', [rule(['pr', 'list'], reply(prList(prJson(box.head(), true))))]);
    const { result } = check();
    expect(result).toEqual({ ok: true, problems: '', prUrl: 'https://example.test/pr/1' });
  });

  test('queries the open pull requests of the current branch', () => {
    box.fake('gh', [rule(['pr', 'list'], reply(prList(prJson(box.head(), true))))]);
    check();
    const args = box.calls('gh')[0].args;
    expect(args.slice(0, 4)).toEqual(['pr', 'list', '--head', 'feature']);
    expect(args).toContain('open');
  });

  test('retries until the pushed head is reported', () => {
    box.fake('gh', [
      rule(['pr', 'list'], reply(prList(prJson(STALE, true))), reply(prList(prJson(box.head(), true)))),
    ]);
    const { result, waits } = check(3, 3);
    expect(result.ok).toBe(true);
    expect(box.calls('gh')).toHaveLength(2);
    expect(waits).toEqual([3000]);
  });

  test('checks once by default', () => {
    box.fake('gh', [rule(['pr', 'list'], reply(prList(prJson(STALE, true))), reply(prList(prJson(box.head(), true))))]);
    const { result, waits } = check();
    expect(result.ok).toBe(false);
    expect(box.calls('gh')).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  const failing: [string, () => string, string][] = [
    ['head mismatch', () => prList(prJson(STALE, true)), 'does not match required draft state or local HEAD'],
    ['not a draft', () => prList(prJson(box.head(), false)), 'draft false'],
    ['no pull request', () => prList(), 'found 0'],
    ['two pull requests', () => prList(prJson(box.head(), true), prJson(box.head(), true)), 'found 2'],
  ];
  test.each(failing)('fails on %s after all attempts', (_name, json, want) => {
    box.fake('gh', [rule(['pr', 'list'], reply(json()))]);
    const { result } = check(2);
    expect(result.ok).toBe(false);
    expect(result.problems).toContain(want);
    expect(result.problems).not.toContain('https://');
    expect(result.prUrl).toBe('');
    expect(box.calls('gh')).toHaveLength(2);
  });

  test('fails with a clear message when gh cannot list pull requests', () => {
    box.fake('gh', [rule(['pr', 'list'], reply('', 1, 'boom'))]);
    const { result } = check(2);
    expect(result.ok).toBe(false);
    expect(result.problems).toContain("could not query the open pull request for branch 'feature'");
  });

  test('rejects a detached HEAD without calling gh', () => {
    box.fake('gh', [rule(['pr', 'list'], reply(prList(prJson(box.head(), true))))]);
    box.git('checkout', '-q', '--detach', box.head());
    const { result } = check();
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('HEAD is detached');
    expect(box.calls('gh')).toEqual([]);
  });
});

describe('acceptancePush (acceptance-push.sh)', () => {
  function setup(): void {
    box.addBareOrigin();
    box.git('push', '-q', '--set-upstream', 'origin', 'feature');
  }

  test('pushes the fix to the configured upstream', () => {
    setup();
    const head = box.commitFix();
    expect(acceptancePush(box.exec)).toEqual({ ok: true, problems: '' });
    expect(box.git('rev-parse', 'origin/feature')).toBe(head);
    expect(box.gitIn(box.path('origin.git'), 'rev-parse', 'feature')).toBe(head);
  });

  test('sets the upstream when the branch has none', () => {
    setup();
    box.git('branch', '--unset-upstream');
    box.commitFix();
    expect(acceptancePush(box.exec).ok).toBe(true);
    expect(box.git('rev-parse', '--abbrev-ref', 'feature@{upstream}')).toBe('origin/feature');
  });

  test('refuses to push uncommitted tracked changes', () => {
    setup();
    box.write('file.txt', 'dirty\n');
    const result = acceptancePush(box.exec);
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('tracked changes are uncommitted');
    expect(result.problems).toContain('file.txt');
  });

  test('ignores untracked files', () => {
    setup();
    box.commitFix();
    box.write('scratch.log', 'x\n');
    expect(acceptancePush(box.exec).ok).toBe(true);
  });

  test('does not force-push a diverged branch', () => {
    setup();
    const remoteHead = box.commitFix('remote\n');
    box.git('push', '-q', 'origin', 'feature');
    box.git('reset', '-q', '--hard', 'HEAD~1');
    box.commitFix('local\n');
    const result = acceptancePush(box.exec);
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('failed');
    expect(box.gitIn(box.path('origin.git'), 'rev-parse', 'feature')).toBe(remoteHead);
  });

  test('rejects a detached HEAD', () => {
    setup();
    box.git('checkout', '-q', '--detach', box.head());
    const result = acceptancePush(box.exec);
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('HEAD is detached');
  });
});

describe('spliceBody (update-pr-body.sh body cases)', () => {
  const block = `${BODY_START}\nFresh delivery\n${BODY_END}\n`;
  const claim = '<!-- agent-factory:claim:abc -->';
  const refs = `Refs #174\n${claim}\n`;

  const cases: [string, string, string][] = [
    ['marked body', `Intro\n${BODY_START}\nStale delivery\n${BODY_END}\n${refs}`, `Intro\n${block}${refs}`],
    [
      'unicode around marked body',
      `🤖 Intro — note\n${BODY_START}\nStale delivery\n${BODY_END}\n${refs}`,
      `🤖 Intro — note\n${block}${refs}`,
    ],
    ['unmarked body', refs, `${block}\n${refs}`],
    ['start marker only', `${BODY_START}\nRefs #174\n`, `${block}\n${BODY_START}\nRefs #174\n`],
    ['end marker only', `${BODY_END}\nRefs #174\n`, `${block}\n${BODY_END}\nRefs #174\n`],
    [
      'reversed markers',
      `${BODY_END}\nOld\n${BODY_START}\n`,
      `${block}\n${BODY_END}\nOld\n${BODY_START}\n`,
    ],
    [
      'duplicated markers',
      `${BODY_START}\nA\n${BODY_END}\nmid\n${BODY_START}\nB\n${BODY_END}\ntail\n`,
      `${block}mid\n${BODY_START}\nB\n${BODY_END}\ntail\n`,
    ],
    ['empty body', '', block],
  ];
  test.each(cases)('%s', (_name, oldBody, want) => {
    expect(spliceBody(oldBody, block)).toBe(want);
  });

  test('splicing is idempotent', () => {
    for (const [, oldBody] of cases) {
      const once = spliceBody(oldBody, block);
      expect(spliceBody(once, block)).toBe(once);
    }
  });

  test('rejects a block without ordered markers', () => {
    expect(() => spliceBody('x', 'no markers')).toThrow('ordered body markers');
    expect(() => spliceBody('x', `${BODY_END}\n${BODY_START}\n`)).toThrow('ordered body markers');
  });
});

describe('updatePrBody (update-pr-body.sh)', () => {
  const block = `${BODY_START}\nFresh delivery\n${BODY_END}\n`;
  const oldBody = `Intro\n${BODY_START}\nStale delivery\n${BODY_END}\nRefs #174\n`;
  const view = ['pr', 'view', '174', '--json', 'body', '-q', '.body'];
  const patch = ['api', '--method', 'PATCH', 'repos/{owner}/{repo}/pulls/174'];

  test('reads the body and patches the spliced body through the REST API', () => {
    box.fake('gh', [rule(view, reply(`${oldBody}\n`)), rule(patch, reply('{"body":"large response"}\n'))]);
    expect(updatePrBody(box.exec, '174', block)).toEqual({ ok: true, problems: '' });
    const calls = box.calls('gh');
    expect(calls[0].args).toEqual(view);
    expect(calls[1].args.slice(0, 5)).toEqual([...patch, '-F']);
    expect(calls[1].args[5]).toStartWith('body=@');
    expect(calls[1].files.body).toBe(`Intro\n${block}Refs #174\n`);
    expect(calls.some(call => call.args.includes('edit'))).toBe(false);
  });

  test('a rerun on its own result patches the same body', () => {
    box.fake('gh', [rule(view, reply(`${oldBody}\n`)), rule(patch, reply('{}'))]);
    updatePrBody(box.exec, '174', block);
    const first = box.calls('gh')[1].files.body;
    box.fake('gh', [rule(view, reply(`${first}\n`)), rule(patch, reply('{}'))]);
    updatePrBody(box.exec, '174', block);
    expect(box.calls('gh').at(-1)?.files.body).toBe(first);
  });

  test('prepends the block to an unmarked body', () => {
    box.fake('gh', [rule(view, reply('Refs #174\n\n')), rule(patch, reply('{}'))]);
    updatePrBody(box.exec, '174', block);
    expect(box.calls('gh')[1].files.body).toBe(`${block}\nRefs #174\n`);
  });

  test('fails clearly when the view fails, without patching', () => {
    box.fake('gh', [rule(view, reply('', 34)), rule(patch, reply('{}'))]);
    const result = updatePrBody(box.exec, '174', block);
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('could not read pull request 174 body');
    expect(box.calls('gh')).toHaveLength(1);
  });

  test('fails clearly when the patch fails', () => {
    box.fake('gh', [rule(view, reply('\n')), rule(patch, reply('', 35))]);
    const result = updatePrBody(box.exec, '174', block);
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('could not update pull request 174 body via REST');
  });

  test('fails on a block without markers', () => {
    box.fake('gh', [rule(view, reply('x\n')), rule(patch, reply('{}'))]);
    const result = updatePrBody(box.exec, '174', 'no markers');
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('could not splice generated pull request body');
  });

  test.each(['', '0', 'abc', '-1', '12x', '1.5'])('rejects pull request number %p without calling gh', number => {
    box.fake('gh', [rule(view, reply('x\n'))]);
    const result = updatePrBody(box.exec, number, block);
    expect(result).toEqual({ ok: false, problems: 'pull request number must be a positive integer' });
    expect(box.calls('gh')).toEqual([]);
  });
});

describe('updateGeneratedBody (update-pr-body)', () => {
  const list = ['pr', 'list', '--head', 'feature', '--state', 'open', '--json', 'number', '--limit', '2'];
  const view = ['pr', 'view', '7', '--json', 'body', '-q', '.body'];
  const patch = ['api', '--method', 'PATCH', 'repos/{owner}/{repo}/pulls/7'];

  test('markBlock wraps the description in the markers', () => {
    expect(markBlock('Summary\n\n')).toBe(`${BODY_START}\nSummary\n${BODY_END}\n`);
  });

  test('finds the branch pull request and patches its body with the marked description', () => {
    box.fake('gh', [rule(list, reply('[{"number":7}]')), rule(view, reply('Refs #1\n')), rule(patch, reply('{}'))]);
    expect(updateGeneratedBody(box.exec, 'Summary\n')).toEqual({ ok: true, problems: '' });
    expect(box.calls('gh')[2].files.body).toBe(`${markBlock('Summary')}\nRefs #1`);
  });

  test.each([
    ['an empty description', '  \n', 'missing or empty'],
    ['a description with a marker', `Summary ${BODY_START}`, 'must not contain the body markers'],
  ])('fails on %s without calling gh', (_name, block, why) => {
    box.fake('gh', [rule(list, reply('[{"number":7}]'))]);
    expect(updateGeneratedBody(box.exec, block).problems).toContain(why);
    expect(box.calls('gh')).toEqual([]);
  });

  test.each([
    ['no open pull request', reply('[]'), 'found 0'],
    ['two open pull requests', reply('[{"number":7},{"number":8}]'), 'found 2'],
    ['a failed query', reply('', 1), 'could not query'],
  ])('fails on %s', (_name, listed, why) => {
    box.fake('gh', [rule(list, listed)]);
    const result = updateGeneratedBody(box.exec, 'Summary');
    expect(result.ok).toBe(false);
    expect(result.problems).toContain(why);
  });

  test('fails on a detached HEAD', () => {
    box.git('checkout', '-q', '--detach');
    expect(updateGeneratedBody(box.exec, 'Summary').problems).toContain('HEAD is detached');
  });
});
