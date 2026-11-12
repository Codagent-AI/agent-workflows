import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  commitChangePlan,
  commitMessage,
  isConfinedRelativePath,
} from '../.archon/workflows/codagent/.shared/lib/commit-plan.ts';
import type { Exec } from '../.archon/workflows/codagent/.shared/lib/exec.ts';
import { type Sandbox, createSandbox } from './helpers.ts';

let box: Sandbox;
beforeEach(() => {
  box = createSandbox();
});
afterEach(() => box.dispose());

const commitPlan = (changeDir = 'openspec/changes/demo', changeName = 'demo', exec: Exec = box.exec) =>
  commitChangePlan(exec, { changeName, changeDir });

const committedFiles = (): string[] => box.git('show', '--pretty=', '--name-only', 'HEAD').split('\n');

describe('commitChangePlan', () => {
  test('includes the OpenSpec bootstrap config and leaves unrelated files alone', () => {
    box.write('openspec/changes/demo/proposal.md', 'proposal\n');
    box.write('openspec/config.yaml', 'schema: spec-driven\n');
    box.write('unrelated.txt', 'leave me alone\n');
    const result = commitPlan();
    expect(result.ok).toBe(true);
    expect(result.message).toBe('committed openspec/changes/demo');
    expect(committedFiles()).toEqual(['openspec/changes/demo/proposal.md', 'openspec/config.yaml']);
    expect(box.git('status', '--porcelain', '--', 'openspec/config.yaml', 'unrelated.txt')).toBe('?? unrelated.txt');
  });

  test('uses a ticket-style subject from a ticket-named change', () => {
    box.write('openspec/changes/plateng-1949-promote-to-eod/proposal.md', 'proposal\n');
    expect(commitPlan('openspec/changes/plateng-1949-promote-to-eod', 'plateng-1949-promote-to-eod').ok).toBe(true);
    expect(box.git('log', '-1', '--format=%s')).toBe('PLATENG-1949: Add change plan');
  });

  test('uses the chore subject for an ordinary change name', () => {
    box.write('openspec/changes/demo/proposal.md', 'proposal\n');
    commitPlan();
    expect(box.git('log', '-1', '--format=%s')).toBe('[commit-plan] chore: add change documents for demo');
  });

  test('restricts the commit to the change directory', () => {
    box.write('openspec/changes/demo/proposal.md', 'proposal\n');
    box.write('staged-elsewhere.txt', 'staged\n');
    box.git('add', 'staged-elsewhere.txt');
    expect(commitPlan().ok).toBe(true);
    expect(committedFiles()).toEqual(['openspec/changes/demo/proposal.md']);
    expect(box.git('status', '--porcelain')).toBe('A  staged-elsewhere.txt');
  });

  test('rejects the repository root without running git', () => {
    const invoked: string[] = [];
    const exec: Exec = (command, args, options) => {
      invoked.push(command);
      return box.exec(command, args, options);
    };
    const result = commitPlan('.', 'demo', exec);
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('change_dir must be a confined relative path');
    expect(invoked).toEqual([]);
  });

  test('replays as a no-op when already committed', () => {
    box.write('openspec/changes/demo/proposal.md', 'proposal\n');
    expect(commitPlan().ok).toBe(true);
    const before = box.head();
    box.write('unrelated.txt', 'dirty\n');
    const result = commitPlan();
    expect(result.ok).toBe(true);
    expect(result.message).toContain('already committed');
    expect(box.head()).toBe(before);
    expect(box.git('status', '--porcelain', '--', 'unrelated.txt')).toBe('?? unrelated.txt');
  });

  test('commits a later edit to an already committed change', () => {
    box.write('openspec/changes/demo/proposal.md', 'proposal\n');
    commitPlan();
    const before = box.head();
    box.write('openspec/changes/demo/proposal.md', 'edited\n');
    expect(commitPlan().ok).toBe(true);
    expect(box.head()).not.toBe(before);
  });

  test('rejects an invalid change name', () => {
    const result = commitPlan('openspec/changes/demo', 'Bad_Name');
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('commit-change-plan: change_name must use lowercase');
  });

  test('fails when the change directory does not exist', () => {
    const result = commitPlan();
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('git add failed');
  });
});

describe('commitChangePlan with an openspec symbolic link', () => {
  let outside: string;
  beforeEach(() => {
    outside = realpathSync(mkdtempSync(join(tmpdir(), 'archon-outside-')));
  });
  afterEach(() => rmSync(outside, { recursive: true, force: true }));

  test('leaves the change uncommitted and says so', () => {
    mkdirSync(join(outside, 'changes', 'demo'), { recursive: true });
    writeFileSync(join(outside, 'changes', 'demo', 'proposal.md'), 'proposal\n');
    symlinkSync(outside, box.path('openspec'));
    const before = box.head();
    const result = commitPlan();
    expect(result.ok).toBe(true);
    expect(result.message).toContain('openspec is a symbolic link');
    expect(box.head()).toBe(before);
  });

  test('fails when the linked change directory is missing', () => {
    symlinkSync(outside, box.path('openspec'));
    const result = commitPlan();
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('change directory not found: openspec/changes/demo');
  });
});

describe('isConfinedRelativePath (rejects dot segments)', () => {
  test.each(['openspec/changes/demo', 'change', 'nested/tasks.md', 'a/b/c'])('accepts %s', path => {
    expect(isConfinedRelativePath(path)).toBe(true);
  });

  test.each(['', '.', './proposal.md', 'nested/./tasks.md', 'nested/.', '..', '../x', 'a/../b', '/abs/path'])(
    'rejects %p',
    path => {
      expect(isConfinedRelativePath(path)).toBe(false);
    }
  );
});

describe('commitMessage', () => {
  test('ticket-style names', () => {
    expect(commitMessage('plateng-1949-promote-to-eod')).toBe('PLATENG-1949: Add change plan');
  });

  test.each(['demo', 'add-widget', 'abc-123', 'abc-x1-thing'])('plain subject for %s', name => {
    expect(commitMessage(name)).toBe(`[commit-plan] chore: add change documents for ${name}`);
  });
});
