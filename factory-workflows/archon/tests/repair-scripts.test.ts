import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { createSandbox, ok, prView, rule, type Sandbox } from './helpers.ts';

const scripts = resolve(import.meta.dir, '../.archon/workflows/codagent/implement-change/scripts');
let box: Sandbox;
beforeEach(() => { box = createSandbox(); });
afterEach(() => box.dispose());

function run(name: string, strict = true) {
  return spawnSync(process.execPath, [join(scripts, `${name}.ts`)], {
    cwd: box.dir, encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, ARTIFACTS_DIR: join(box.binDir, 'artifacts'),
      INPUTS_STRICT: String(strict), INPUTS_BLOCKED: 'false', INPUTS_REASON: '',
      INPUTS_ATTEMPTS: '1', INPUTS_INTERVAL_SECONDS: '0',
      ARCHON_CLI_COMMAND: JSON.stringify([join(box.binDir, 'archon')]) },
  });
}

describe('nonblocked repair rechecks and script artifacts', () => {
  test.each(['tracked', 'untracked'])('a still-dirty %s worktree fails its strict recheck', kind => {
    const file = kind === 'tracked' ? 'file.txt' : 'untracked.txt';
    box.write(file, 'uncommitted change\n');
    const initial = run('verify-clean-for-pr', false);
    expect(initial.status).toBe(0);
    expect(JSON.parse(initial.stdout)).toMatchObject({ ok: false });
    // The nonblocked repair leaves the file dirty: the actual checker must run again.
    const recheck = run('verify-clean-for-pr');
    expect(recheck.status).toBe(1);
    expect(recheck.stderr).toContain(file);
    expect(recheck.stderr).toContain('working tree changes remain');
    expect(recheck.stderr).not.toContain('REPAIR_BLOCKED');
  });

  test('a failed push after a nonblocked repair fails its strict recheck without force', () => {
    const origin = box.addBareOrigin();
    box.git('push', '-q', '--set-upstream', 'origin', 'feature');
    const remote = box.commitFix('remote\n'); box.git('push', '-q');
    box.git('reset', '-q', '--hard', 'HEAD~1'); box.commitFix('local\n');
    const initial = run('acceptance-push', false);
    expect(initial.status).toBe(0);
    expect(JSON.parse(initial.stdout)).toMatchObject({ ok: false });
    const recheck = run('acceptance-push');
    expect(recheck.status).toBe(1);
    expect(recheck.stderr).toContain('acceptance push: git push');
    expect(recheck.stderr).toContain('failed');
    expect(recheck.stderr).not.toContain('REPAIR_BLOCKED');
    expect(box.gitIn(origin, 'rev-parse', 'feature')).toBe(remote);
  });

  test('check-draft-pr prints the URL and writes every verified metadata field', () => {
    const head = box.head();
    box.forgeTools([rule(['forge', 'pr.view'], ok('pr.view', prView({ head_revision: head })))]);
    const checked = run('check-draft-pr');
    expect(checked.status).toBe(0);
    expect(checked.stderr).toBe('');
    expect(JSON.parse(checked.stdout)).toEqual({ ok: true, problems: '', pr_url: 'https://github.com/owner/repo/pull/7' });
    const saved = JSON.parse(readFileSync(join(box.binDir, 'artifacts/pull-request.json'), 'utf8'));
    expect(saved).toEqual({ url: 'https://github.com/owner/repo/pull/7', number: 7, branch: 'feature',
      base: 'main', draft: true, head_revision: head });
  });
});
