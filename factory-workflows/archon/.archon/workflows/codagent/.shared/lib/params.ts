// Input checks the workflows run before any other node.

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

/** The most acceptance rounds a run can have: the loop's max_iterations must be a literal. */
export const MAX_ACCEPTANCE_ROUNDS = 10;

export function acceptanceRoundsProblems(value: string): Problems {
  const rounds = /^[0-9]+$/.test(value) ? Number(value) : Number.NaN;
  return rounds >= 1 && rounds <= MAX_ACCEPTANCE_ROUNDS
    ? []
    : [`acceptance_rounds must be a whole number from 1 to ${MAX_ACCEPTANCE_ROUNDS}, got: ${value}`];
}

/** The inputs both workflows check before any other node. The two flags are verify-change's. */
export interface WorkflowInputs {
  changeName: string;
  acceptanceRounds: string;
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
    ...flags.flatMap(([name, value]) => (value === undefined ? [] : booleanProblems(name, value))),
    ...nonEmptyProblems('acceptance_fix_scope', inputs.acceptanceFixScope),
    ...acceptanceRoundsProblems(inputs.acceptanceRounds),
  ];
}
