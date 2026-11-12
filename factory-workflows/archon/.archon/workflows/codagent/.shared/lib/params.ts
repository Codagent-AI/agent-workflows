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

const OPENSPEC_ROOT = 'openspec/changes';

const trimSlashes = (root: string): string => root.replace(/\/+$/, '');

/** The change's folder: the pack's changes root, then the change's name. */
export function changeDir(changesRoot: string, changeName: string): string {
  return `${trimSlashes(changesRoot)}/${changeName}`;
}

/** The sentence that tells agents how to validate a changed artifact: the setting, else the kind's own. */
export function validationInstruction(changeKind: string, changeName: string, setting: string): string {
  if (setting !== '' || changeKind !== 'openspec') return setting;
  return `When an approved artifact changed, run \`openspec validate --type change "${changeName}"\`.`;
}

/** Problems with the changes root: the OpenSpec CLI only reads changes from its own folder. */
export function changesRootProblems(changeKind: string, changesRoot: string): Problems {
  const problems = nonEmptyProblems('changes_root', changesRoot);
  if (problems.length > 0) return problems;
  if (changeKind === 'openspec' && trimSlashes(changesRoot) !== OPENSPEC_ROOT) {
    return [`changes_root must be ${OPENSPEC_ROOT} for openspec: ${changesRoot}`];
  }
  return [];
}

/** The inputs both workflows check before any other node. The two flags are verify-change's. */
export interface WorkflowInputs {
  changeName: string;
  changeKind: string;
  changesRoot: string;
  /** The setting as given: empty means the kind's own sentence. */
  validationSetting: string;
  acceptanceRounds: string;
  /** The most acceptance rounds the workflow allows: the loop's max_iterations. */
  maxRounds: number;
  acceptanceFixScope: string;
  skipImplementationReview?: string;
  stopUnchangedAcceptance?: string;
}

/** Problems with any of the inputs, empty when they are all valid. */
export function inputProblems(inputs: WorkflowInputs): Problems {
  const flags: [string, string | undefined][] = [
    ['skip_implementation_review', inputs.skipImplementationReview],
    ['stop_unchanged_acceptance', inputs.stopUnchangedAcceptance],
  ];
  return [
    ...changeNameProblems(inputs.changeName),
    ...changesRootProblems(inputs.changeKind, inputs.changesRoot),
    ...nonEmptyProblems(
      'artifact_validation_instruction',
      validationInstruction(inputs.changeKind, inputs.changeName, inputs.validationSetting)
    ),
    ...flags.flatMap(([name, value]) => (value === undefined ? [] : booleanProblems(name, value))),
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
      change_dir: changeDir(inputs.changesRoot, inputs.changeName),
      artifact_validation_instruction: validationInstruction(inputs.changeKind, inputs.changeName, inputs.validationSetting),
      ...extra,
    })
  );
}

/** The inputs both validate-inputs scripts read. The two flags are verify-change's alone. */
export function readInputs(env: NodeJS.ProcessEnv): WorkflowInputs {
  return {
    changeName: required(env.INPUTS_CHANGE_NAME, 'change_name'),
    changeKind: required(env.INPUTS_CHANGE_KIND, 'change_kind'),
    changesRoot: required(env.INPUTS_CHANGES_ROOT, 'changes_root'),
    validationSetting: required(env.INPUTS_ARTIFACT_VALIDATION_INSTRUCTION, 'artifact_validation_instruction'),
    maxRounds: Number(required(env.INPUTS_MAX_ROUNDS, 'max_rounds')),
    acceptanceRounds: required(env.INPUTS_ACCEPTANCE_ROUNDS, 'acceptance_rounds'),
    acceptanceFixScope: required(env.INPUTS_ACCEPTANCE_FIX_SCOPE, 'acceptance_fix_scope'),
    skipImplementationReview: env.INPUTS_SKIP_IMPLEMENTATION_REVIEW,
    stopUnchangedAcceptance: env.INPUTS_STOP_UNCHANGED_ACCEPTANCE,
  };
}
