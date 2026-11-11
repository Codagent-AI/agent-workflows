// Checks every input before any other node, and prints the typed values later nodes read.
import { fail, pass, requireOk, required } from '../../.shared/lib/check.ts';
import { inputProblems } from '../../.shared/lib/params.ts';

const rounds = required(process.env.INPUTS_ACCEPTANCE_ROUNDS, 'acceptance_rounds');
const skipReview = required(process.env.INPUTS_SKIP_IMPLEMENTATION_REVIEW, 'skip_implementation_review');
const stopUnchanged = required(process.env.INPUTS_STOP_UNCHANGED_ACCEPTANCE, 'stop_unchanged_acceptance');
const problems = inputProblems({
  changeName: required(process.env.INPUTS_CHANGE_NAME, 'change_name'),
  maxRounds: Number(required(process.env.INPUTS_MAX_ROUNDS, 'max_rounds')),
  acceptanceRounds: rounds,
  acceptanceFixScope: required(process.env.INPUTS_ACCEPTANCE_FIX_SCOPE, 'acceptance_fix_scope'),
  skipImplementationReview: skipReview,
  stopUnchangedAcceptance: stopUnchanged,
});
if (problems.length > 0) requireOk(fail(problems), '');
requireOk(pass(), JSON.stringify({ rounds: Number(rounds), review: skipReview === 'false', stop_unchanged: stopUnchanged === 'true' }));
