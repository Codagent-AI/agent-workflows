import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { type PlanningInput, validatePlanningArtifacts } from '../.archon/workflows/codagent/.shared/lib/planning.ts';
import { type Sandbox, createSandbox, reply, rule } from './helpers.ts';

const TEST_PLAN = `## Coverage Strategy

Use the lowest reliable layer.

## Integration Tests

### INT-001: Widget boundary
- Covers: Widget behavior
- Boundary: CLI and service

## Coverage Map

| Requirement or journey | INT | E2E | HT |
| --- | --- | --- | --- |
| Widget behavior | INT-001 | E2E-001 | — |
`;

const OPENSPEC_SPEC =
  '## ADDED Requirements\n### Requirement: Widget\nThe system SHALL work.\n#### Scenario: Works\n- **WHEN** used\n- **THEN** it works\n';

let box: Sandbox;
beforeEach(() => {
  box = createSandbox(false);
});
afterEach(() => box.dispose());

const validate = (input: Partial<PlanningInput> = {}) =>
  validatePlanningArtifacts(box.exec, {
    changeName: 'demo',
    changeDir: 'openspec/changes/demo',
    changeKind: 'openspec',
    ...input,
  });

function writeOpenSpecChange(): void {
  box.fake('openspec', [rule(['validate'], reply(''))]);
  const dir = 'openspec/changes/demo';
  box.write(`${dir}/proposal.md`, '# Proposal\n');
  box.write(`${dir}/design.md`, '# Design\n');
  box.write(`${dir}/test-plan.md`, TEST_PLAN);
  box.write(`${dir}/specs/widgets/spec.md`, OPENSPEC_SPEC);
}

describe('validatePlanningArtifacts (definition checks)', () => {
  test('definition validation passes and asks openspec to validate the change', () => {
    writeOpenSpecChange();
    const result = validate();
    expect(result).toEqual({ ok: true, problems: '' });
    expect(box.calls('openspec').map(call => call.args)).toEqual([['validate', '--type', 'change', 'demo']]);
  });

  test('free-form test plan', () => {
    writeOpenSpecChange();
    box.write('openspec/changes/demo/test-plan.md', '# Test plan\n\nExercise the public workflow manually.\n');
    expect(validate().ok).toBe(true);
  });

  test('missing test plan', () => {
    writeOpenSpecChange();
    box.write('openspec/changes/demo/test-plan.md', '');
    const result = validate();
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('missing or empty openspec/changes/demo/test-plan.md');
  });

  test('a failing openspec validate reports its output', () => {
    writeOpenSpecChange();
    box.fake('openspec', [rule(['validate'], reply('Change demo is invalid\n', 1, 'boom\n'))]);
    const result = validate();
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('Change demo is invalid');
    expect(result.problems).toContain('boom');
  });

  test('no specification fails', () => {
    writeOpenSpecChange();
    box.write('openspec/changes/demo/specs/widgets/spec.md', '');
    const result = validate();
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('no non-empty specification under openspec/changes/demo/specs/');
  });
});

describe('validatePlanningArtifacts input checks', () => {
  test('rejects a bad change name before running anything', () => {
    writeOpenSpecChange();
    const result = validate({ changeName: 'Bad Name' });
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('validate-planning-artifacts: change_name must use lowercase');
    expect(box.calls('openspec')).toEqual([]);
  });

  test('rejects an unsupported change kind', () => {
    expect(validate({ changeKind: 'markdown' }).problems).toContain('unsupported change_kind: markdown');
  });

  test('rejects an empty change dir', () => {
    expect(validate({ changeDir: '', changeKind: 'spec-driven' }).problems).toContain('change_dir must not be empty');
  });

  test('openspec requires the conventional change dir', () => {
    const result = validate({ changeDir: 'elsewhere/demo' });
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('change_dir must be openspec/changes/demo for openspec: elsewhere/demo');
  });
});

describe('validatePlanningArtifacts spec-driven kind', () => {
  const dir = 'changes/demo';
  const write = (spec: string): void => {
    box.write(`${dir}/proposal.md`, '# Proposal\n');
    box.write(`${dir}/design.md`, '# Design\n');
    box.write(`${dir}/test-plan.md`, TEST_PLAN);
    box.write(`${dir}/specs/widgets/spec.md`, spec);
  };
  const run = () => validate({ changeDir: dir, changeKind: 'spec-driven' });

  test('a complete spec passes without running openspec', () => {
    write(OPENSPEC_SPEC);
    expect(run().ok).toBe(true);
    expect(box.calls('openspec')).toEqual([]);
  });

  test('a spec without a requirement heading fails', () => {
    write('# Widgets\n\nNothing here.\n');
    expect(run().problems).toContain("contains no '### Requirement:' heading");
  });

  test('a requirement without SHALL or MUST fails', () => {
    write('### Requirement: Widget\nThe system works.\n#### Scenario: Works\n- **WHEN** used\n- **THEN** it works\n');
    expect(run().problems).toContain("requirement 'Widget' lacks SHALL or MUST language");
  });

  test('a requirement without a scenario fails', () => {
    write('### Requirement: Widget\nThe system MUST work.\n');
    expect(run().problems).toContain("requirement 'Widget' has no '#### Scenario:'");
  });

  test('a scenario without WHEN or THEN fails', () => {
    write('### Requirement: Widget\nThe system MUST work.\n#### Scenario: Works\n- it works\n');
    const result = run();
    expect(result.problems).toContain("scenario 'Works' lacks WHEN behavior");
    expect(result.problems).toContain("scenario 'Works' lacks THEN behavior");
  });
});
