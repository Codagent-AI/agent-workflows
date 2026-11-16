// Input checks the workflows run before any other node.
import { fail, pass, requireOk, required } from './check.ts';

/** Problems with the inputs, empty when they are valid. */
export type Problems = string[];

const CHANGE_NAME = /^[a-z0-9][a-z0-9-]*$/;

export function changeNameProblems(changeName: string): Problems {
  return CHANGE_NAME.test(changeName)
    ? []
    : [`change_name must use lowercase letters, digits, and hyphens: ${changeName}`];
}

export function booleanProblems(name: string, value: string): Problems {
  return value === 'true' || value === 'false' ? [] : [`${name} must be true or false, got: ${value}`];
}

// Only ASCII whitespace counts as empty: a non-breaking space is content.
export function nonEmptyProblems(name: string, value: string): Problems {
  return value.replace(/[ \t\n\v\f\r]/g, '') === '' ? [`${name} must not be empty`] : [];
}

/** `max` is the acceptance loop's max_iterations, which must be a literal in the workflow. */
export function acceptanceRoundsProblems(value: string, max: number): Problems {
  const rounds = /^[0-9]+$/.test(value) ? Number(value) : Number.NaN;
  return rounds >= 1 && rounds <= max
    ? []
    : [`acceptance_rounds must be a whole number from 1 to ${String(max)}, got: ${value}`];
}

/** Every change belongs to the repository's OpenSpec project. */
export function changeDir(changeName: string): string { return `openspec/changes/${changeName}`; }
export function validationInstruction(changeName: string): string {
  return `When an approved artifact changed, run \`openspec validate --type change "${changeName}"\`.`;
}

/** Inputs checked before any other implement workflow node. */
export interface WorkflowInputs {
  changeName: string;
  acceptanceRounds: string;
  /** The most acceptance rounds the workflow allows: the loop's max_iterations. */
  maxRounds: number;
  acceptanceFixScope: string;
  reviewStrategy: string;
  stopAfter: string;
}

/** Problems with any of the inputs, empty when they are all valid. */
export function inputProblems(inputs: WorkflowInputs): Problems {
  return [
    ...changeNameProblems(inputs.changeName),
    ...(inputs.reviewStrategy === 'builtin' || inputs.reviewStrategy === 'none' ? [] : ['review_strategy must be builtin or none']),
    ...(inputs.stopAfter === 'finish' || inputs.stopAfter === 'acceptance' ? [] : ['stop_after must be finish or acceptance']),
    ...nonEmptyProblems('acceptance_fix_scope', inputs.acceptanceFixScope),
    ...acceptanceRoundsProblems(inputs.acceptanceRounds, inputs.maxRounds),
  ];
}

/**
 * Ends a workflow's validate-inputs script: fails on any problem, else prints the values every
 * later node reads (the derived folder and validation sentence, then the workflow's own).
 */
export function validateRun(inputs: WorkflowInputs, extra: Record<string, unknown> = {}): void {
  const problems = inputProblems(inputs);
  requireOk(
    problems.length === 0 ? pass() : fail(problems),
    JSON.stringify({
      change_dir: changeDir(inputs.changeName),
      artifact_validation_instruction: validationInstruction(inputs.changeName),
      ...extra,
    })
  );
}

/** Bindings read by the implement workflow input validator. */
export function readInputs(env: NodeJS.ProcessEnv): WorkflowInputs {
  return {
    changeName: required(env.INPUTS_CHANGE_NAME, 'change_name'),
    maxRounds: Number(required(env.INPUTS_MAX_ROUNDS, 'max_rounds')),
    acceptanceRounds: required(env.INPUTS_ACCEPTANCE_ROUNDS, 'acceptance_rounds'),
    acceptanceFixScope: required(env.INPUTS_ACCEPTANCE_FIX_SCOPE, 'acceptance_fix_scope'),
    reviewStrategy: required(env.INPUTS_REVIEW_STRATEGY, 'review_strategy'),
    stopAfter: required(env.INPUTS_STOP_AFTER, 'stop_after'),
  };
}
