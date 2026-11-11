import { fail, pass, requireOk, required } from '../../.shared/lib/check.ts';
import { changeNameProblems } from '../../.shared/lib/params.ts';

const problems = changeNameProblems(required(process.env.INPUTS_CHANGE_NAME, 'change_name'));
requireOk(problems.length === 0 ? pass() : fail(problems), 'inputs are valid');
