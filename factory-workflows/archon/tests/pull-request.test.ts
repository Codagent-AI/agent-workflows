import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  FORGE_OPERATIONS,
  OPS,
  checkForgeAccess,
  cliFromEnv,
  interpret,
  remoteHost,
} from '../.archon/workflows/codagent/.shared/lib/forge.ts';
import {
  BODY_END,
  BODY_START,
  acceptancePush,
  checkDraftPr,
  markBlock,
  publishDraftPr,
  restoreDraft,
  spliceBody,
} from '../.archon/workflows/codagent/.shared/lib/pull-request.ts';
import {
  type Sandbox,
  createSandbox,
  failed,
  ok,
  prView,
  recordingSleep,
  requestOf,
  rule,
} from './helpers.ts';

let box: Sandbox;
beforeEach(() => {
  box = createSandbox();
});
afterEach(() => box.dispose());

const STALE = '0123456789abcdef0123456789abcdef01234567';
const VIEW = ['forge', 'pr.view'];
const found = (record: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  rule(VIEW, ok('pr.view', prView(record, extra)));

describe('checkDraftPr (check-draft-pr.sh)', () => {
  const check = (rules = [found({ head_revision: box.head() })], attempts = 1, interval = 0) => {
    const { sleep, waits } = recordingSleep();
    return { result: checkDraftPr(box.forgeTools(rules), sleep, attempts, interval), waits };
  };

  test('returns the pull request when the draft is at local HEAD', () => {
    const { result } = check();
    expect(result).toEqual({
      ok: true,
      problems: '',
      prUrl: 'https://github.com/owner/repo/pull/7',
      pr: {
        url: 'https://github.com/owner/repo/pull/7',
        number: 7,
        branch: 'feature',
        base: 'main',
        draft: true,
        head_revision: box.head(),
      },
    });
  });

  test('looks the pull request up by its head branch in the resolved repository', () => {
    check();
    const calls = box.calls('archon').filter(call => call.args[1] === 'pr.view');
    expect(requestOf(calls[0])).toEqual({
      selector: {
        kind: 'head',
        repo: { host: 'github.com', path: 'owner/repo' },
        headRepo: { host: 'github.com', path: 'owner/repo' },
        head: 'feature',
      },
    });
    expect(calls[0].args).toContain('--data-file');
    expect(calls[0].args).not.toContain('--data');
  });

  test('retries until the pushed head is reported', () => {
    const rules = [
      rule(VIEW, ok('pr.view', prView({ head_revision: STALE })), ok('pr.view', prView({ head_revision: box.head() }))),
    ];
    const { result, waits } = check(rules, 3, 3);
    expect(result.ok).toBe(true);
    expect(box.calls('archon').filter(call => call.args[1] === 'pr.view')).toHaveLength(2);
    expect(waits).toEqual([3000]);
  });

  test('checks once by default', () => {
    const rules = [rule(VIEW, ok('pr.view', prView({ head_revision: STALE })), ok('pr.view', prView({ head_revision: box.head() })))];
    const { result, waits } = check(rules);
    expect(result.ok).toBe(false);
    expect(waits).toEqual([]);
  });

  const failing: [string, () => ReturnType<typeof found>, string][] = [
    ['head mismatch', () => found({ head_revision: STALE }), 'does not match required draft state or local HEAD'],
    ['not a draft', () => found({ is_draft: false, head_revision: box.head() }), 'draft false'],
    ['a merged pull request', () => found({ state: 'merged', head_revision: box.head() }), 'state merged'],
    ['no pull request', () => rule(VIEW, ok('pr.view', null)), 'found 0'],
    ['two pull requests', () => rule(VIEW, failed('conflict', 'two open pull requests match')), 'forge pr.view failed (conflict): two open'],
  ];
  test.each(failing)('fails on %s after all attempts', (_name, makeRule, want) => {
    const { result } = check([makeRule()], 2);
    expect(result.ok).toBe(false);
    expect(result.problems).toContain(want);
    expect(result.problems).not.toContain('https://');
    expect(result.prUrl).toBe('');
    expect(box.calls('archon').filter(call => call.args[1] === 'pr.view')).toHaveLength(2);
  });

  test('fails with the forge reason when the lookup is refused', () => {
    const { result } = check([rule(VIEW, failed('authorization', 'bad credentials'))], 2);
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('forge pr.view failed (authorization): bad credentials');
  });

  test('fails when no plugin claims the remote', () => {
    const rules = [rule(['forge', 'resolve'], ok('resolve', { kind: 'none', forge: 'none' })), found()];
    const result = checkDraftPr(box.forgeTools(rules), () => {}, 1, 0);
    expect(result.problems).toContain("no forge plugin claims the git remote 'origin'");
  });

  test('rejects a detached HEAD without calling the forge', () => {
    const tools = box.forgeTools([found()]);
    box.git('checkout', '-q', '--detach', box.head());
    const result = checkDraftPr(tools, () => {}, 1, 0);
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('HEAD is detached');
    expect(box.calls('archon')).toEqual([]);
  });

  test('an audit failure (exit 2) is a problem even though the answer said ok', () => {
    const rules = [rule(VIEW, { ...ok('pr.view', prView({ head_revision: box.head() })), status: 2 })];
    const { result } = check(rules);
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('its run audit could not be persisted');
  });
});

describe('restoreDraft', () => {
  const DRAFT = ['forge', 'pr.draft'];

  test('converts the open pull request to draft', () => {
    const tools = box.forgeTools([found({ is_draft: false }), rule(DRAFT, ok('pr.draft', { outcome: 'applied', changed: true }))]);
    expect(restoreDraft(tools)).toEqual({ ok: true, problems: '' });
    const draft = box.calls('archon').find(call => call.args[1] === 'pr.draft');
    expect(draft && requestOf(draft)).toEqual({ ref: { repo: { host: 'github.com', path: 'owner/repo' }, number: 7 } });
  });

  test('a refusal is reported with its outcome', () => {
    const tools = box.forgeTools([found(), rule(DRAFT, failed('conflict', 'the pull request is merged', { outcome: 'refused' }))]);
    const result = restoreDraft(tools);
    expect(result.ok).toBe(false);
    expect(result.problems).toBe('forge pr.draft refused: the pull request is merged');
  });

  test('fails when the branch has no open pull request', () => {
    const result = restoreDraft(box.forgeTools([rule(VIEW, ok('pr.view', null)), rule(DRAFT, ok('pr.draft', {}))]));
    expect(result.problems).toContain("no open pull request for branch 'feature'");
    expect(box.calls('archon').some(call => call.args[1] === 'pr.draft')).toBe(false);
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

describe('publishDraftPr', () => {
  const CREATE = ['forge', 'pr.create'];
  const EDIT = ['forge', 'pr.edit-body'];
  const DRAFT = ['forge', 'pr.draft'];
  const description = { title: 'Add greeting', block: 'Summary\n' };
  const opsCalled = (): string[] => box.calls('archon').map(call => call.args[1]).filter(op => op !== 'resolve');

  test('opens a draft pull request with the marked description when the branch has none', () => {
    const tools = box.forgeTools([rule(VIEW, ok('pr.view', null)), rule(CREATE, ok('pr.create', { outcome: 'applied', changed: true }))]);
    expect(publishDraftPr(tools, description)).toEqual({ ok: true, problems: '' });
    const created = box.calls('archon').find(call => call.args[1] === 'pr.create');
    expect(created && requestOf(created)).toEqual({
      repo: { host: 'github.com', path: 'owner/repo' },
      headRepo: { host: 'github.com', path: 'owner/repo' },
      head: 'feature',
      headRevision: box.head(),
      base: 'main',
      title: 'Add greeting',
      body: markBlock('Summary'),
      draft: true,
    });
    expect(created?.args).not.toContain('--data');
  });

  test('puts the description into an existing body, keeps what a human added, and keeps it a draft', () => {
    const body = `Intro\n${BODY_START}\nStale\n${BODY_END}\nRefs #174\n`;
    const tools = box.forgeTools([
      found({ is_draft: false }, { body }),
      rule(EDIT, ok('pr.edit-body', { outcome: 'applied', changed: true })),
      rule(DRAFT, ok('pr.draft', { outcome: 'applied', changed: true })),
    ]);
    expect(publishDraftPr(tools, { title: '', block: 'Fresh\n' })).toEqual({ ok: true, problems: '' });
    const edit = box.calls('archon').find(call => call.args[1] === 'pr.edit-body');
    expect(edit && requestOf(edit)).toEqual({
      ref: { repo: { host: 'github.com', path: 'owner/repo' }, number: 7 },
      body: `Intro\n${markBlock('Fresh')}Refs #174\n`,
    });
    expect(opsCalled()).toEqual(['pr.view', 'pr.edit-body', 'pr.draft']);
  });

  test('a rerun on its own result sends the same body', () => {
    const body = markBlock('Fresh');
    const tools = box.forgeTools([found({}, { body }), rule(EDIT, ok('pr.edit-body', {})), rule(DRAFT, ok('pr.draft', {}))]);
    publishDraftPr(tools, { title: '', block: 'Fresh\n' });
    const edit = box.calls('archon').find(call => call.args[1] === 'pr.edit-body');
    expect(edit && requestOf(edit).body).toBe(body);
  });

  test.each([
    ['an empty description', { title: 't', block: '  \n' }, 'missing or empty'],
    ['a description with a marker', { title: 't', block: `Summary ${BODY_START}` }, 'must not contain the body markers'],
  ])('fails on %s without calling the forge', (_name, given, why) => {
    const tools = box.forgeTools([found()]);
    expect(publishDraftPr(tools, given).problems).toContain(why);
    expect(box.calls('archon')).toEqual([]);
  });

  test('a new pull request needs a title', () => {
    const tools = box.forgeTools([rule(VIEW, ok('pr.view', null)), rule(CREATE, ok('pr.create', {}))]);
    expect(publishDraftPr(tools, { title: ' \n', block: 'Summary' }).problems).toContain('title is missing or empty');
    expect(opsCalled()).toEqual(['pr.view']);
  });

  test.each([
    ['refused', { outcome: 'refused' }, 'forge pr.create refused: head is not pushed'],
    ['verification_failed', { outcome: 'verification_failed', leaveBehind: 'draft #9' }, 'forge pr.create verification_failed: head is not pushed (may remain on the forge: draft #9)'],
    ['outcome_unknown', { outcome: 'outcome_unknown' }, 'forge pr.create outcome_unknown: head is not pushed'],
  ])('reports a %s creation', (_name, mutation, want) => {
    const tools = box.forgeTools([rule(VIEW, ok('pr.view', null)), rule(CREATE, failed('forge_error', 'head is not pushed', mutation))]);
    expect(publishDraftPr(tools, description)).toEqual({ ok: false, problems: want });
  });

  test('a failed body edit stops before the draft conversion', () => {
    const tools = box.forgeTools([found(), rule(EDIT, failed('forge_error', 'denied', { outcome: 'refused' })), rule(DRAFT, ok('pr.draft', {}))]);
    expect(publishDraftPr(tools, description).problems).toBe('forge pr.edit-body refused: denied');
    expect(opsCalled()).toEqual(['pr.view', 'pr.edit-body']);
  });

  test('a remote with no default branch cannot get a pull request', () => {
    const tools = box.forgeTools([rule(VIEW, ok('pr.view', null)), rule(CREATE, ok('pr.create', {}))]);
    box.git('remote', 'set-url', 'origin', box.path('missing.git'));
    expect(publishDraftPr(tools, description).problems).toContain("could not read the default branch of the remote 'origin'");
    expect(opsCalled()).toEqual(['pr.view']);
  });
});

describe('forge.ts', () => {
  test('the preflight names exactly the operations the pack calls', () => {
    const lib = join(import.meta.dir, '..', '.archon', 'workflows', 'codagent', '.shared', 'lib');
    const named = new Set<string>();
    for (const file of readdirSync(lib)) {
      for (const match of readFileSync(join(lib, file), 'utf8').matchAll(/OPS\.(\w+)/g)) named.add(match[1]);
    }
    expect([...named].sort()).toEqual(Object.keys(OPS).sort());
    expect(new Set(FORGE_OPERATIONS).size).toBe(Object.keys(OPS).length);
  });

  test.each([
    ['git@github.com:owner/repo.git', 'github.com'],
    ['ssh://git@GitHub.com/owner/repo.git', 'github.com'],
    ['https://github.com/owner/repo', 'github.com'],
    ['http://github.example.com:8080/team/repo.git', 'github.example.com:8080'],
    ['https://user:token@github.com/owner/repo.git', 'github.com'],
    ['/some/local/path.git', undefined],
    ['', undefined],
  ])('the host of %p is %p', (url, host) => {
    expect(remoteHost(url)).toBe(host);
  });

  test.each([
    ['["archon"]', ['archon']],
    ['["bun","/x/cli.ts"]', ['bun', '/x/cli.ts']],
    ['archon', undefined],
    ['[]', undefined],
    ['[1]', undefined],
    [undefined, undefined],
  ])('ARCHON_CLI_COMMAND %p is read as %p', (value, argv) => {
    expect(cliFromEnv({ ARCHON_CLI_COMMAND: value })).toEqual(argv);
  });

  test('an envelope that is not JSON is a problem with the exit status', () => {
    expect(interpret('pr.view', 3, 'oops', 'boom\n')).toEqual({
      ok: false,
      problem: 'forge pr.view printed no JSON envelope (exit 3): boom',
    });
  });

  test('an answer for another operation is a problem', () => {
    const envelope = JSON.stringify({ ok: true, result: { op: 'pr.draft', value: {} } });
    expect(interpret('pr.view', 0, envelope, '')).toEqual({ ok: false, problem: 'forge pr.view answered for pr.draft' });
  });

  describe('checkForgeAccess', () => {
    const cliEnv = () => ({ ARCHON_CLI_COMMAND: JSON.stringify([join(box.binDir, 'archon')]) });
    const CHECK = ['forge', 'check'];
    const accessOk = ok('check', { host: 'github.com', plugin: { name: 'github', version: '0.14.0' }, operations: [], credentialSource: 'GH_TOKEN' });

    // A remote on GitHub; forgeTools' own origin is a local path, as the push tests need.
    const onGithub = (rules: ReturnType<typeof rule>[]): void => {
      box.forgeTools(rules);
      box.git('remote', 'set-url', 'origin', 'git@github.com:owner/repo.git');
    };

    test('asks the plugin of the remote host for exactly the pack operations', () => {
      onGithub([rule(CHECK, accessOk)]);
      const result = checkForgeAccess(box.exec, cliEnv());
      expect(result).toEqual({ ok: true, problems: '', message: 'forge ready: github 0.14.0 serves github.com, credential from GH_TOKEN' });
      const call = box.calls('archon').find(entry => entry.args[1] === 'check');
      expect(call && requestOf(call)).toEqual({ host: 'github.com', operations: FORGE_OPERATIONS });
    });

    test('reports a missing plugin, an unsupported operation and a missing credential', () => {
      onGithub([rule(CHECK, failed('no_plugin_for_host', 'no forge plugin claims github.com'))]);
      expect(checkForgeAccess(box.exec, cliEnv()).problems).toBe('forge check failed (no_plugin_for_host): no forge plugin claims github.com');
      onGithub([rule(CHECK, failed('no_credential', 'GH_TOKEN is not set'))]);
      expect(checkForgeAccess(box.exec, cliEnv()).problems).toContain('(no_credential)');
    });

    test('fails when the Archon CLI is not published or the remote has no host', () => {
      expect(checkForgeAccess(box.exec, {}).problems).toContain('ARCHON_CLI_COMMAND');
      box.forgeTools([rule(CHECK, accessOk)]);
      expect(checkForgeAccess(box.exec, cliEnv()).problems).toContain("cannot read a host from the git remote 'origin'");
    });
  });
});
