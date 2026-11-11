// Validates the approved definition. Run first it reports the result; after a repair it
// reports the repair's result, and the loop ends when the definition is valid.
import { required, runCheck } from '../../.shared/lib/check.ts';
import { runCommand } from '../../.shared/lib/exec.ts';
import { validatePlanningArtifacts } from '../../.shared/lib/planning.ts';

runCheck(() =>
  validatePlanningArtifacts(runCommand, {
    changeName: required(process.env.INPUTS_CHANGE_NAME, 'change_name'),
    changeDir: required(process.env.INPUTS_CHANGE_DIR, 'change_dir'),
    changeKind: required(process.env.INPUTS_CHANGE_KIND, 'change_kind'),
  })
);
