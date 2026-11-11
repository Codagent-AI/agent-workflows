// The committed checklist is the plan: check-evidence later compares the checklist with the
// copy saved here, so implementation cannot change a planned row.
import { join } from 'node:path';

import { artifactsDir, checkMode, report, required, stopIfBlocked } from '../../.shared/lib/check.ts';
import { verifyChecklist } from '../../.shared/lib/checklist.ts';
import { runCommand } from '../../.shared/lib/exec.ts';

const mode = checkMode();
stopIfBlocked(mode);
const changeDir = required(process.env.INPUTS_CHANGE_DIR, 'change_dir');
report(verifyChecklist(runCommand, changeDir, join(artifactsDir(), 'planned-checklist.md')), mode);
