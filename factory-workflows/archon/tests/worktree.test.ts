import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  checkCommitsSince,
  checkNotBlocked,
  checkTrackedClean,
  changedPaths,
  checkWorktreeClean,
  head,
  status,
} from '../.archon/workflows/codagent/.shared/lib/worktree.ts';
import { ARTIFACTS } from '../.archon/workflows/codagent/.shared/lib/artifacts.ts';
import { type Sandbox, createSandbox } from './helpers.ts';

let box: Sandbox;
beforeEach(() => {
  box = createSandbox();
});
afterEach(() => box.dispose());

describe('checkNotBlocked (check-not-blocked.sh)', () => {
  test('passes when there is no blocked record', () => {
    expect(checkNotBlocked(box.dir)).toEqual({ ok: true, problems: '' });
  });

  test('fails with the record and the restart advice when one exists', () => {
    box.write(ARTIFACTS.blocked, 'Decision needed: which export format?\n');
    const result = checkNotBlocked(box.dir);
    expect(result.ok).toBe(false);
    for (const want of ['without a user decision', 'Decision needed: which export format?', 'start a new run']) {
      expect(result.problems).toContain(want);
    }
  });
});

describe('checkTrackedClean', () => {
  test('passes on a clean tree and ignores untracked files', () => {
    box.write('build-output.log', 'untracked\n');
    expect(checkTrackedClean(box.exec, 'dirty').ok).toBe(true);
  });

  test('fails with the problem and the changed file when a tracked file is modified', () => {
    box.write('file.txt', 'dirty\n');
    const result = checkTrackedClean(box.exec, 'tracked files have changes');
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('tracked files have changes');
    expect(result.problems).toContain('file.txt');
  });
});

describe('checkWorktreeClean', () => {
  test('passes on a clean tree', () => {
    expect(checkWorktreeClean(box.exec, 'dirty').ok).toBe(true);
  });

  test('fails on an untracked file', () => {
    box.write('new.txt', 'new\n');
    const result = checkWorktreeClean(box.exec, 'worktree has changes');
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('?? new.txt');
  });
});

describe('checkCommitsSince', () => {
  test('fails when nothing was committed since the start head', () => {
    const result = checkCommitsSince(box.exec, box.head());
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('the change was not implemented');
  });

  test('passes after a commit', () => {
    const start = box.head();
    box.commitFix();
    expect(checkCommitsSince(box.exec, start).ok).toBe(true);
  });

  test('fails when the start head is unknown', () => {
    const result = checkCommitsSince(box.exec, '0123456789012345678901234567890123456789');
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('could not count commits');
  });
});

describe('head and status', () => {
  test('head returns the full SHA', () => {
    expect(head(box.exec)).toBe(box.head());
  });

  test('status returns porcelain lines without a trailing newline', () => {
    box.write('a.txt', 'a\n');
    expect(status(box.exec)).toBe('?? a.txt');
    expect(status(box.exec, ['--untracked-files=no'])).toBe('');
  });
});

describe('changedPaths', () => {
  test('lists tracked and untracked changes, unquoted', () => {
    box.write('file.txt', 'changed\n');
    box.write('my notes.txt', 'new\n');
    expect(changedPaths(box.exec)?.sort()).toEqual(['file.txt', 'my notes.txt']);
  });

  test('lists a renamed path once, by its new name', () => {
    box.git('mv', 'file.txt', 'moved.txt');
    expect(changedPaths(box.exec)).toEqual(['moved.txt']);
  });

  test('is empty for a clean worktree and undefined when git fails', () => {
    expect(changedPaths(box.exec)).toEqual([]);
    expect(changedPaths(() => ({ status: 128, stdout: '', stderr: 'fatal' }))).toBeUndefined();
  });
});
