import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  acceptanceRoundsProblems,
  booleanProblems,
  changeNameProblems,
  inputProblems,
  nonEmptyProblems,
} from '../.archon/workflows/codagent/.shared/lib/params.ts';

describe('changeNameProblems (validate-change-name.sh)', () => {
  test.each(['demo', 'a', '0demo', 'plateng-1949-promote-to-eod', 'a-b-c', 'x1'])('accepts %s', name => {
    expect(changeNameProblems(name)).toEqual([]);
  });

  test.each(['', '-leading', 'Upper', 'under_score', 'has space', 'dot.name', 'slash/name', '../escape', 'trailing\n'])(
    'rejects %p',
    name => {
      const problems = changeNameProblems(name);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('change_name must use lowercase letters, digits, and hyphens');
    }
  );
});

describe('booleanProblems (validate-boolean-param.sh)', () => {
  test('accepts true and false', () => {
    expect(booleanProblems('skip_validator', 'true')).toEqual([]);
    expect(booleanProblems('skip_validator', 'false')).toEqual([]);
  });

  test.each(['', 'TRUE', 'yes', '1', ' true', 'false '])('rejects %p and names the parameter', value => {
    const problems = booleanProblems('skip_validator', value);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('skip_validator must be true or false');
  });
});

describe('nonEmptyProblems (TestValidateNonemptyParam)', () => {
  // [name, value, empty]
  const rows: [string, string, boolean][] = [
    ['empty', '', true],
    ['spaces', '   ', true],
    ['newline tab cr', '\n\t\r', true],
    ['text', 'Fix defects.', false],
    ['quotes and backslash', 'text "quoted" \\ text', false],
    ['leading quote', '"text', false],
    ['multiline', 'line\nline', false],
    ['value substring', '"value":""', false],
    ['form feed', '\f', true],
    ['vertical tab', '\u000b', true],
    ['all ascii whitespace', ' \t\n\u000b\f\r', true],
    ['literal form feed', '\\f', false],
    ['literal vertical tab', '\\u000b', false],
    ['backslash pair', '\\\\', false],
    ['lone backslash', '\\', false],
    ['nul', '\x00', false],
    ['nul with whitespace', ' \x00\t\n', false],
    ['nbsp', '\u00a0', false],
    ['line separator', '\u2028', false],
  ];
  test.each(rows)('%s', (_name, value, empty) => {
    const problems = nonEmptyProblems('acceptance_fix_scope', value);
    if (empty) expect(problems).toEqual(['acceptance_fix_scope must not be empty']);
    else expect(problems).toEqual([]);
  });
});

describe('acceptanceRoundsProblems', () => {
  test.each(['1', '3', '10'])('accepts %s', value => {
    expect(acceptanceRoundsProblems(value, 10)).toEqual([]);
  });

  test('the ceiling is the one given', () => {
    expect(acceptanceRoundsProblems('4', 3)).toHaveLength(1);
    expect(acceptanceRoundsProblems('3', 3)).toEqual([]);
  });

  test.each(['0', '11', '', '-1', '1.5', 'three', ' 3', '3 ', '1e1'])('rejects %p', value => {
    const problems = acceptanceRoundsProblems(value, 10);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('from 1 to 10');
  });
});

describe('inputProblems', () => {
  const valid = { changeName: 'demo', acceptanceRounds: '3', maxRounds: 10, acceptanceFixScope: 'resolve everything' };

  test('accepts valid inputs, with or without verify-change flags', () => {
    expect(inputProblems(valid)).toEqual([]);
    expect(inputProblems({ ...valid, skipImplementationReview: 'true', stopUnchangedAcceptance: 'false' })).toEqual([]);
  });

  test('reports every problem at once', () => {
    expect(
      inputProblems({
        changeName: 'Demo',
        acceptanceRounds: '0',
        maxRounds: 10,
        acceptanceFixScope: ' ',
        skipImplementationReview: 'yes',
      })
    ).toHaveLength(4);
  });

  test('checks the flags only when given', () => {
    expect(inputProblems({ ...valid, stopUnchangedAcceptance: 'maybe' })).toEqual([
      'stop_unchanged_acceptance must be true or false, got: maybe',
    ]);
  });
});

// The loader reads only a node's own script for INPUTS_* names, not the modules it imports,
// so a misspelt `strict:` would load cleanly. This is the check that catches it.
describe('check script bindings', () => {
  const pack = join(import.meta.dir, '..', '.archon', 'workflows', 'codagent');
  const workflows = readdirSync(pack).filter(name => !name.startsWith('.'));
  const checkScripts = (workflow: string): Set<string> => {
    const dir = join(pack, workflow, 'scripts');
    const names = readdirSync(dir).filter(file => /runCheck\(/.test(readFileSync(join(dir, file), 'utf8')));
    return new Set(names.map(file => file.replace(/\.ts$/, '')));
  };
  interface Node {
    id: string;
    script?: string;
    with?: Record<string, unknown>;
    loop_group?: { nodes: Node[] };
  }
  const flatten = (nodes: Node[]): Node[] => nodes.flatMap(node => [node, ...flatten(node.loop_group?.nodes ?? [])]);

  test.each(workflows)('%s binds strict, blocked and reason on every check node', workflow => {
    const scripts = checkScripts(workflow);
    const parsed = Bun.YAML.parse(readFileSync(join(pack, workflow, `${workflow}.yaml`), 'utf8')) as { nodes: Node[] };
    const missing = flatten(parsed.nodes)
      .filter(node => node.script !== undefined && scripts.has(node.script))
      .flatMap(node => ['strict', 'blocked', 'reason'].filter(name => !(name in (node.with ?? {}))).map(name => `${node.id}: ${name}`));
    expect(missing).toEqual([]);
  });
});

// Timing values live in the YAML, next to the loop or timeout they depend on, and reach the
// scripts through bindings. These tests fail when the two drift apart.
describe('timing bindings', () => {
  const pack = join(import.meta.dir, '..', '.archon', 'workflows', 'codagent');
  interface Node {
    id: string;
    with?: Record<string, number | string>;
    timeout?: number;
    loop_group?: { max_iterations: number; nodes: Node[] };
  }
  const load = (workflow: string): Node[] =>
    (Bun.YAML.parse(readFileSync(join(pack, workflow, `${workflow}.yaml`), 'utf8')) as { nodes: Node[] }).nodes;
  const find = (nodes: Node[], id: string): Node => {
    const all = nodes.flatMap(node => [node, ...(node.loop_group?.nodes ?? [])]);
    const found = all.find(node => node.id === id);
    if (!found) throw new Error(`no node ${id}`);
    return found;
  };

  test('max_rounds is the acceptance loop ceiling in both workflows', () => {
    const ceiling = find(load('verify-change'), 'acceptance-rounds').loop_group?.max_iterations;
    expect(ceiling).toBeGreaterThan(0);
    expect(find(load('verify-change'), 'validate-inputs').with?.max_rounds).toBe(ceiling);
    expect(find(load('implement-change'), 'validate-inputs').with?.max_rounds).toBe(ceiling);
  });

  test('the wait-ci timeout outlasts the minutes it polls', () => {
    const node = find(load('verify-change'), 'wait-ci');
    expect(node.timeout).toBeGreaterThan(Number(node.with?.max_minutes) * 60_000);
  });

  test('every draft pull request check binds its retry interval', () => {
    const checks = load('verify-change').flatMap(node => [node, ...(node.loop_group?.nodes ?? [])]);
    const draftChecks = checks.filter(node => node.with?.attempts !== undefined);
    expect(draftChecks.length).toBeGreaterThan(0);
    for (const node of draftChecks) expect(node.with?.interval_seconds).toBe(3);
  });
});
