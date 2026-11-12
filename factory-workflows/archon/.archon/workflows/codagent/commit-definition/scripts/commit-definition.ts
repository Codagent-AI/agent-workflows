// Commits the approved definition, except for a spec-driven change, whose planning step
// commits it. Rerun with `strict` after a repair.
import { pass, required, runCheck } from '../../.shared/lib/check.ts';
import { commitChangePlan } from '../../.shared/lib/commit-plan.ts';
import { runCommand } from '../../.shared/lib/exec.ts';

runCheck(() => {
  const changeName = required(process.env.INPUTS_CHANGE_NAME, 'change_name');
  const changeDir = required(process.env.INPUTS_CHANGE_DIR, 'change_dir');
  if (required(process.env.INPUTS_CHANGE_KIND, 'change_kind') === 'spec-driven') {
    return { ...pass(), message: 'a spec-driven change commits its definition in its planning step' };
  }
  return commitChangePlan(runCommand, { changeName, changeDir });
});
