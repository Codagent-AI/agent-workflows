import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  acceptanceRoundsProblems,
  booleanProblems,
  changeDir,
  changeNameProblems,
  changesRootProblems,
  inputProblems,
  nonEmptyProblems,
  validationInstruction,
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

describe('changeDir and changesRootProblems', () => {
  test('the change folder is the changes root and the name', () => {
    expect(changeDir('openspec/changes', 'demo')).toBe('openspec/changes/demo');
    expect(changeDir('specs/changes/', 'demo')).toBe('specs/changes/demo');
  });

  test('an openspec change must use the OpenSpec folder, and a spec-driven one may not', () => {
    expect(changesRootProblems('openspec', 'openspec/changes/')).toEqual([]);
    expect(changesRootProblems('openspec', 'elsewhere')).toEqual(['changes_root must be openspec/changes for openspec: elsewhere']);
    expect(changesRootProblems('spec-driven', 'elsewhere')).toEqual([]);
  });

  test('the root must not be empty', () => {
    expect(changesRootProblems('spec-driven', ' ')).toEqual(['changes_root must not be empty']);
  });
});

describe('validationInstruction', () => {
  test('an openspec change gets the sentence naming it', () => {
    expect(validationInstruction('openspec', 'demo', '')).toBe(
      'When an approved artifact changed, run `openspec validate --type change "demo"`.'
    );
  });

  test('the setting wins, and a spec-driven change has none of its own', () => {
    expect(validationInstruction('openspec', 'demo', 'Run the linter.')).toBe('Run the linter.');
    expect(validationInstruction('spec-driven', 'demo', '')).toBe('');
  });
});

describe('inputProblems', () => {
  const valid = { changeName: 'demo', changesRoot: 'openspec/changes', changeKind: 'openspec', validationSetting: '', acceptanceRounds: '3', maxRounds: 10, acceptanceFixScope: 'resolve everything', reviewStrategy: 'builtin' };

  test('accepts valid inputs with either strategy', () => {
    expect(inputProblems(valid)).toEqual([]);
    expect(inputProblems({ ...valid, reviewStrategy: 'none' })).toEqual([]);
  });

  test('reports every problem at once', () => {
    const problems = inputProblems({ ...valid, changeName: 'Demo', changesRoot: 'elsewhere',
      validationSetting: ' ', acceptanceRounds: '0', acceptanceFixScope: ' ' });
    expect(problems).toHaveLength(5);
    for (const name of ['change_name', 'changes_root', 'artifact_validation_instruction', 'acceptance_rounds', 'acceptance_fix_scope']) {
      expect(problems.join('\n')).toContain(name);
    }
  });

  test('checks the root against the kind when the kind is given', () => {
    expect(inputProblems({ ...valid, changeKind: 'openspec', changesRoot: 'elsewhere' })).toHaveLength(1);
    expect(inputProblems({ ...valid, changeKind: 'spec-driven', changesRoot: 'elsewhere', validationSetting: 'Lint.' })).toEqual([]);
    expect(inputProblems({ ...valid, changeKind: 'spec-driven' })).toEqual(['artifact_validation_instruction must not be empty']);
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

  test('max_rounds is the implement acceptance loop ceiling', () => {
    const ceiling = find(load('implement-change'), 'acceptance-rounds').loop_group?.max_iterations;
    expect(ceiling).toBeGreaterThan(0);
    expect(find(load('implement-change'), 'validate-inputs').with?.max_rounds).toBe(ceiling);
  });

  test('the wait-ci timeout outlasts the minutes it polls', () => {
    const node = find(load('implement-change'), 'wait-ci');
    expect(node.timeout).toBeGreaterThan(Number(node.with?.max_minutes) * 60_000);
  });

  test('every draft pull request check binds its retry interval', () => {
    const checks = load('implement-change').flatMap(node => [node, ...(node.loop_group?.nodes ?? [])]);
    const draftChecks = checks.filter(node => node.with?.attempts !== undefined);
    expect(draftChecks.length).toBeGreaterThan(0);
    for (const node of draftChecks) expect(node.with?.interval_seconds).toBe(3);
  });
});

// A block takes nothing from its pack, so implement-change passes each pack setting a block
// declares through `with:`. A per-run `--input` override reaches the block only if the value
// passed is the includer's own `$INPUTS.<name>`; these tests fail when one is dropped or renamed.
describe('pack settings reach the included blocks', () => {
  const pack = join(import.meta.dir, '..', '.archon', 'workflows', 'codagent');
  interface Workflow {
    inputs?: Record<string, unknown>;
    nodes: { id: string; include?: string; with?: Record<string, string> }[];
  }
  const read = (path: string): Workflow => Bun.YAML.parse(readFileSync(join(pack, path), 'utf8')) as Workflow;
  const settings = Object.keys((read('.pack/pack.yaml').inputs ?? {}) as Record<string, unknown>);
  const includes = read('implement-change/implement-change.yaml').nodes.filter(node => node.include !== undefined);

  test('the pack declares the project constants', () => {
    expect(settings.sort()).toEqual(
      [
        'acceptance_fix_scope',
        'acceptance_rounds',
        'artifact_validation_instruction',
        'change_kind',
        'change_label',
        'changes_root',
        'review_strategy',
      ].sort()
    );
  });

  test('the run declares no input a setting already declares', () => {
    const own = Object.keys(read('implement-change/implement-change.yaml').inputs ?? {});
    expect(own.filter(name => settings.includes(name))).toEqual([]);
  });

  test.each(includes.map(node => [node.id, node] as const))('%s is given every input it declares', (_id, node) => {
    const target = node.include?.replace(/^codagent-/, '') ?? '';
    const declared = Object.entries(read(`${target}/${target}.yaml`).inputs ?? {}).filter(
      ([, spec]) => (spec as { default?: string }).default === undefined
    );
    expect(Object.keys(node.with ?? {}).sort()).toEqual(expect.arrayContaining(declared.map(([name]) => name).sort()));
    expect(Object.keys(node.with ?? {}).filter(name => !(name in (read(`${target}/${target}.yaml`).inputs ?? {})))).toEqual([]);
  });

  test.each(includes.map(node => [node.id, node] as const))('%s passes each setting on unchanged', (_id, node) => {
    const passed = Object.entries(node.with ?? {}).filter(([name]) => settings.includes(name));
    expect(passed.filter(([name, value]) => value !== `$INPUTS.${name}`)).toEqual([]);
  });
});

// Declarative workflow contracts that must remain true after merging verification.
describe('merged workflow contracts', () => {
  const pack = join(import.meta.dir, '..', '.archon', 'workflows', 'codagent');
  interface WorkflowNode {
    id: string;
    model?: string[];
    context?: string | { resume: string };
    depends_on?: string[];
    loop_group?: { max_iterations: number; on_exhausted?: string; nodes: WorkflowNode[] };
  }
  const load = (name: string) => Bun.YAML.parse(readFileSync(join(pack, name, `${name}.yaml`), 'utf8')) as {
    nodes: WorkflowNode[]; returns: string; outcome_field: string;
  };
  const workflow = load('implement-change');
  const flatten = (entries: WorkflowNode[]): WorkflowNode[] => entries.flatMap(entry => [entry, ...flatten(entry.loop_group?.nodes ?? [])]);
  const nodes = flatten(workflow.nodes);
  const node = (id: string) => {
    const value = nodes.find(candidate => candidate.id === id);
    if (!value) throw new Error(`missing ${id}`);
    return value;
  };

  test('strategy and kind are launch enums with approved defaults', () => {
    const settings = (Bun.YAML.parse(readFileSync(join(pack, '.pack/pack.yaml'), 'utf8')) as {
      inputs: Record<string, { type: string; values: string[]; default: string }>;
    }).inputs;
    expect(settings.review_strategy).toMatchObject({ type: 'enum', values: ['builtin', 'none'], default: 'builtin' });
    expect(settings.change_kind).toMatchObject({ type: 'enum', values: ['openspec', 'spec-driven'], default: 'openspec' });
  });

  test('validation is first and authored outcome comes from acceptance status', () => {
    expect(workflow.nodes[0]?.id).toBe('validate-inputs');
    expect(workflow.returns).toBe('write-acceptance-status');
    expect(workflow.outcome_field).toBe('ready');
    expect(readdirSync(pack)).not.toContain('verify-change');
  });

  test('every agent declares an approved role, fallback tier and context', () => {
    const tiers: Record<string, string> = { '@implementor': 'large', '@crosscheck': 'large', '@reviewer': 'medium', '@tester': 'medium' };
    const all = ['implement-change', 'check-definition', 'commit-definition'].flatMap(name => flatten(load(name).nodes));
    for (const entry of all.filter(candidate => candidate.model)) {
      expect(entry.model).toHaveLength(2);
      expect(entry.model?.[1]).toBe(tiers[entry.model?.[0] ?? '']);
      expect(entry.context).toBeDefined();
    }
  });

  test('pre-pr and round reviewers fork the correct session owners', () => {
    for (const id of ['review-change', 'tail-review', 'round-review']) expect(node(id).context).toBe('fresh');
    expect(node('fix-review-findings').context).toEqual({ resume: 'session-report' });
    expect(node('re-review').context).toEqual({ resume: 'review-change' });
    expect(node('fix-round-findings').context).toEqual({ resume: 'acceptance-fix' });
    expect(node('round-re-review').context).toEqual({ resume: 'round-review' });
    expect(node('acceptance-fix').context).toEqual({ resume: 'open-draft-pr' });
  });

  test('review exhaustion completes at three and acceptance uses one plain fixer', () => {
    expect(node('review-fixes').loop_group).toMatchObject({ max_iterations: 3, on_exhausted: 'complete' });
    const body = node('acceptance-rounds').loop_group?.nodes ?? [];
    expect(body.filter(entry => entry.id === 'fix-round-findings')).toHaveLength(1);
    expect(body.some(entry => entry.loop_group)).toBe(false);
  });
});
