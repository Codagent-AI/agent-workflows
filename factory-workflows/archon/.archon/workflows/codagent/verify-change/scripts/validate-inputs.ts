// Checks every input before any other node, and prints the typed values later nodes read.
import { fail, pass, requireOk, required } from '../../.shared/lib/check.ts';
import { acceptanceRoundsProblems, booleanProblems, changeNameProblems, nonEmptyProblems } from '../../.shared/lib/params.ts';

const rounds = required(process.env.INPUTS_ACCEPTANCE_ROUNDS, 'acceptance_rounds');
const skipReview = required(process.env.INPUTS_SKIP_IMPLEMENTATION_REVIEW, 'skip_implementation_review');
const stopUnchanged = required(process.env.INPUTS_STOP_UNCHANGED_ACCEPTANCE, 'stop_unchanged_acceptance');
const problems = [
  ...changeNameProblems(required(process.env.INPUTS_CHANGE_NAME, 'change_name')),
  ...booleanProblems('skip_implementation_review', skipReview),
  ...booleanProblems('stop_unchanged_acceptance', stopUnchanged),
  ...nonEmptyProblems('acceptance_fix_scope', required(process.env.INPUTS_ACCEPTANCE_FIX_SCOPE, 'acceptance_fix_scope')),
  ...acceptanceRoundsProblems(rounds),
];
if (problems.length > 0) requireOk(fail(problems), '');
requireOk(pass(), JSON.stringify({ rounds: Number(rounds), review: skipReview === 'false', stop_unchanged: stopUnchanged === 'true' }));
