// Checks every input the run passes on to verify-change before any other node, so a bad
// acceptance_rounds fails now and not after the whole implementation.
import { fail, pass, requireOk, required } from '../../.shared/lib/check.ts';
import { inputProblems } from '../../.shared/lib/params.ts';

const problems = inputProblems({
  changeName: required(process.env.INPUTS_CHANGE_NAME, 'change_name'),
  acceptanceRounds: required(process.env.INPUTS_ACCEPTANCE_ROUNDS, 'acceptance_rounds'),
  acceptanceFixScope: required(process.env.INPUTS_ACCEPTANCE_FIX_SCOPE, 'acceptance_fix_scope'),
});
requireOk(problems.length === 0 ? pass() : fail(problems), 'inputs are valid');
