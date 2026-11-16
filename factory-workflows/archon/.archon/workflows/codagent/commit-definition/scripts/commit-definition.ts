// Commits the approved OpenSpec definition; rerun in strict mode after a repair.
import { required, runCheck } from '../../.shared/lib/check.ts';
import { commitChangePlan } from '../../.shared/lib/commit-plan.ts';
import { runCommand } from '../../.shared/lib/exec.ts';

runCheck(() => {
  const changeName = required(process.env.INPUTS_CHANGE_NAME, 'change_name');
  const changeDir = required(process.env.INPUTS_CHANGE_DIR, 'change_dir');
  return commitChangePlan(runCommand, { changeName, changeDir });
});
