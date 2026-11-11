// The checklist step must leave only the checklist behind: no commits and no other changes.
// The check then commits the checklist, so implementation starts from a committed checklist.
// `start` is where the step started, from Archon's checkout observation.
import { artifactsDir, requireOk, required } from '../../.shared/lib/check.ts';
import { checkImplementorChecklist } from '../../.shared/lib/checklist.ts';
import { checkoutStart } from '../../.shared/lib/checkout.ts';
import { runCommand } from '../../.shared/lib/exec.ts';

const observed = checkoutStart(required(process.env.INPUTS_START, 'start'), artifactsDir());
requireOk(
  'failure' in observed
    ? observed.failure
    : checkImplementorChecklist(runCommand, {
        changeDir: required(process.env.INPUTS_CHANGE_DIR, 'change_dir'),
        changeName: required(process.env.INPUTS_CHANGE_NAME, 'change_name'),
        start: observed.start,
      }),
  'checklist committed'
);
