import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  MAX_ACCEPTANCE_ROUNDS,
  acceptanceRoundsProblems,
  booleanProblems,
  changeNameProblems,
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
    expect(acceptanceRoundsProblems(value)).toEqual([]);
  });

  test.each(['0', '11', '', '-1', '1.5', 'three', ' 3', '3 ', '1e1'])('rejects %p', value => {
    const problems = acceptanceRoundsProblems(value);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`from 1 to ${String(MAX_ACCEPTANCE_ROUNDS)}`);
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
