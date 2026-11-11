import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  cells,
  checkImplementorChecklist,
  checklistPath,
  rawCells,
  tableShapeProblems,
  verifyChecklist,
} from '../.archon/workflows/codagent/.shared/lib/checklist.ts';
import { checkoutStart } from '../.archon/workflows/codagent/.shared/lib/checkout.ts';
import { type Sandbox, createSandbox } from './helpers.ts';

let box: Sandbox;
beforeEach(() => {
  box = createSandbox();
});
afterEach(() => box.dispose());

const PLAN_HEADER = '| ID | Behavior | How to verify |\n|----|----|----|\n';

describe('rawCells and cells', () => {
  test('keeps an escaped pipe inside its cell', () => {
    expect(rawCells('| L-1 | Reads a \\| b | e2e |')).toEqual(['L-1', 'Reads a | b', 'e2e']);
  });

  test('cells collapses whitespace runs', () => {
    expect(cells('| L-1 | Export   works |')).toEqual(['L-1', 'Export works']);
  });
});

describe('tableShapeProblems (verify-checklist table shape)', () => {
  test('a well-formed table has no problems', () => {
    expect(tableShapeProblems(`# Checklist\n\n${PLAN_HEADER}| L-1 | Export works | e2e |\n`)).toEqual([]);
  });

  test('an escaped pipe stays inside its cell', () => {
    expect(tableShapeProblems(`${PLAN_HEADER}| L-1 | Reads a \\| b | e2e |\n`)).toEqual([]);
  });

  test('an unescaped pipe splits a row into too many cells', () => {
    const problems = tableShapeProblems(`${PLAN_HEADER}| L-1 | Reads a | b | e2e |\n`);
    expect(problems).toEqual(['checklist row L-1 does not have 3 cells; escape any | inside a cell as \\|']);
  });

  test('text with no table fails', () => {
    expect(tableShapeProblems('# Checklist\n\nNothing.\n')).toEqual(['checklist has no table with an ID column']);
  });

  test('a table without an ID column fails', () => {
    expect(tableShapeProblems('| Name | Value |\n|----|----|\n| a | b |\n')).toEqual([
      'checklist has no table with an ID column',
    ]);
  });

  test('an earlier table without an ID column does not hide a later one', () => {
    expect(tableShapeProblems(`| Name |\n|----|\n| a |\n\n${PLAN_HEADER}| L-1 | x | y |\n`)).toEqual([]);
  });

  test('an annotated ID header counts as an ID column', () => {
    expect(tableShapeProblems('| ID (merged) | B |\n|--|--|\n| M-1 (L-1) | x |\n')).toEqual([]);
  });
});

describe('verifyChecklist (verify-checklist)', () => {
  const dir = 'change';
  const commitList = (): void => {
    box.write('output/.keep', '');
    box.git('add', `${dir}/checklist.md`);
    box.commit('add checklist');
  };
  const plan = (): string => box.path('output/planned-checklist.md');

  test('saves a committed, well-formed checklist as the plan', () => {
    box.write(`${dir}/checklist.md`, `${PLAN_HEADER}| L-1 | Export works | e2e |\n`);
    commitList();
    expect(verifyChecklist(box.exec, dir, plan())).toEqual({ ok: true, problems: '' });
    expect(box.read('output/planned-checklist.md')).toBe(box.read(`${dir}/checklist.md`));
  });

  test('fails when the checklist is missing or empty', () => {
    expect(verifyChecklist(box.exec, dir, plan()).problems).toContain('change/checklist.md is missing or empty');
    box.write(`${dir}/checklist.md`, '');
    expect(verifyChecklist(box.exec, dir, plan()).problems).toContain('is missing or empty');
  });

  test('fails when the checklist has uncommitted changes', () => {
    box.write(`${dir}/checklist.md`, `${PLAN_HEADER}| L-1 | Export works | e2e |\n`);
    commitList();
    box.write(`${dir}/checklist.md`, `${PLAN_HEADER}| L-1 | x | y |\n`);
    const result = verifyChecklist(box.exec, dir, plan());
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('has uncommitted changes');
    expect(box.exists('output/planned-checklist.md')).toBe(false);
  });

  test('fails on a malformed row without saving the plan', () => {
    box.write(`${dir}/checklist.md`, `${PLAN_HEADER}| L-1 | a | b | c |\n`);
    commitList();
    const result = verifyChecklist(box.exec, dir, plan());
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('checklist row L-1 does not have 3 cells');
    expect(box.exists('output/planned-checklist.md')).toBe(false);
  });
});

describe('checkImplementorChecklist (check-implementor-checklist)', () => {
  const dir = 'change';
  let definitionHead: string;
  let dirtyPaths: Set<string>;
  beforeEach(() => {
    definitionHead = box.head();
    dirtyPaths = new Set();
  });
  const start = () => ({ commit: definitionHead, dirtyPaths });
  const run = () => checkImplementorChecklist(box.exec, { changeDir: dir, changeName: 'demo', start: start() });

  test('commits the checklist when it is the only change', () => {
    box.write(`${dir}/checklist.md`, `${PLAN_HEADER}| I-1 | x | y |\n`);
    expect(run()).toEqual({ ok: true, problems: '' });
    expect(box.git('log', '-1', '--format=%s')).toBe(
      '[check-implementor-checklist] docs: add verification checklist for demo'
    );
    expect(box.git('show', '--pretty=', '--name-only', 'HEAD')).toBe('change/checklist.md');
    expect(box.git('status', '--porcelain')).toBe('');
  });

  test('fails when the step committed work', () => {
    box.write(`${dir}/checklist.md`, 'x\n');
    box.commitFix();
    const result = run();
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('implementor-checklist committed work; it may only write change/checklist.md');
  });

  test('fails when other files changed', () => {
    box.write(`${dir}/checklist.md`, 'x\n');
    box.write('stray.txt', 'stray\n');
    const result = run();
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('changed files other than change/checklist.md');
    expect(result.problems).toContain('stray.txt');
    expect(box.head()).toBe(definitionHead);
  });

  test('a file whose path contains the checklist path counts as another change', () => {
    box.write(`${dir}/checklist.md`, 'x\n');
    box.write(`${dir}/checklist.md.bak`, 'stray\n');
    const result = run();
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('change/checklist.md.bak');
    expect(box.head()).toBe(definitionHead);
  });

  test('ignores changes that were already there before the step', () => {
    box.write('earlier.txt', 'earlier\n');
    dirtyPaths = new Set(['earlier.txt']);
    box.write(`${dir}/checklist.md`, 'x\n');
    expect(run().ok).toBe(true);
    expect(box.git('status', '--porcelain')).toBe('?? earlier.txt');
  });

  test('an earlier change to a path with a space is not another change', () => {
    box.write('my notes.txt', 'earlier\n');
    dirtyPaths = new Set(['my notes.txt']);
    box.write(`${dir}/checklist.md`, 'x\n');
    expect(run().ok).toBe(true);
  });

  test('fails when no checklist was written', () => {
    const result = run();
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('did not write change/checklist.md');
  });

  test('fails when the checklist is empty', () => {
    box.write(`${dir}/checklist.md`, '');
    expect(run().problems).toContain('did not write');
  });

  test('leaves a checklist outside the repository uncommitted', () => {
    const outside = mkdtempSync(join(tmpdir(), 'archon-outside-'));
    try {
      const changeDir = join(outside, 'change');
      mkdirSync(changeDir);
      writeFileSync(join(changeDir, 'checklist.md'), 'x\n');
      const result = checkImplementorChecklist(box.exec, { changeDir, changeName: 'demo', start: start() });
      expect(result.ok).toBe(true);
      expect(box.head()).toBe(definitionHead);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test('checklistPath joins the change directory', () => {
    expect(checklistPath('a/b')).toBe('a/b/checklist.md');
  });
});

describe('checkoutStart (a node.execution.checkoutStart binding)', () => {
  const commit = 'a'.repeat(40);
  const git = (worktree: object, extra: object = {}): string =>
    JSON.stringify({ kind: 'git', sampledAt: '2026-11-11T00:00:00Z', commit, tree: 'b'.repeat(40), worktree, ...extra });
  const manifest = (entries: object[]): { json: string; digest: string } => {
    const json = JSON.stringify({ version: 1, objectFormat: 'sha1', commit, entries });
    return { json, digest: createHash('sha256').update(json).digest('hex') };
  };
  const dirty = (digest: string): string =>
    git({ status: 'dirty', manifest: { pointer: { type: 'archon_artifact', run_id: 'r', path: '.archon/checkout/m.json' }, sha256: digest, entries: 1 } });
  const put = (json: string): void => box.write('artifacts/.archon/checkout/m.json', json);
  const mismatched = (): string => {
    put('{"entries":[]}');
    return '0'.repeat(64);
  };

  test('a clean start carries its commit and no dirty paths', () => {
    expect(checkoutStart(git({ status: 'clean' }), box.path('artifacts'))).toEqual({
      start: { commit, dirtyPaths: new Set() },
    });
  });

  test('a dirty start carries the manifest paths, including a base64 path', () => {
    const { json, digest } = manifest([
      { path: 'a.txt', kind: 'file', mode: '100644', blob: 'c'.repeat(40) },
      { path: { base64: Buffer.from('b.txt').toString('base64') }, kind: 'absent' },
    ]);
    put(json);
    expect(checkoutStart(dirty(digest), box.path('artifacts'))).toEqual({
      start: { commit, dirtyPaths: new Set(['a.txt', 'b.txt']) },
    });
  });

  test('the commit alone does not read the manifest', () => {
    expect(checkoutStart(dirty('0'.repeat(64)), box.path('artifacts'), false)).toEqual({
      start: { commit, dirtyPaths: new Set() },
    });
  });

  test.each([
    ['a manifest that is missing', () => dirty('0'.repeat(64)), 'is unreadable'],
    ['a manifest that does not match its digest', () => dirty(mismatched()), 'does not match its recorded digest'],
    ['a checkout that is not git', () => JSON.stringify({ kind: 'not_git' }), 'the checkout is not_git'],
    ['an observation that could not be made', () => JSON.stringify({ kind: 'unavailable', reason: 'git_failed' }), 'the checkout is unavailable'],
    ['an unborn branch', () => git({ status: 'clean' }, { commit: null }), 'no commit yet'],
    ['text that is not JSON', () => 'not json', 'the checkout is unreadable'],
  ])('refuses %s', (_name, raw, why) => {
    const observed = checkoutStart(raw(), box.path('artifacts'));
    expect('failure' in observed && observed.failure.problems).toContain(why);
  });
});
