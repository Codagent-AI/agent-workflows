// Validates the approved definition. The loop's check reports the result; verify-definition
// runs it with `strict` after the loop and fails when it still does not pass.
import { checkMode, report, required } from '../../.shared/lib/check.ts';
import { runCommand } from '../../.shared/lib/exec.ts';
import { validatePlanningArtifacts } from '../../.shared/lib/planning.ts';

const result = validatePlanningArtifacts(runCommand, {
  changeName: required(process.env.INPUTS_CHANGE_NAME, 'change_name'),
  changeDir: required(process.env.INPUTS_CHANGE_DIR, 'change_dir'),
  changeKind: required(process.env.INPUTS_CHANGE_KIND, 'change_kind'),
  requireTasks: false,
});
report(result, checkMode());
