// The committed checklist is the plan: check-evidence later compares the checklist with the
// copy saved here, so implementation cannot change a planned row.
import { join } from 'node:path';

import { artifactsDir, required, runCheck } from '../../.shared/lib/check.ts';
import { verifyChecklist } from '../../.shared/lib/checklist.ts';
import { runCommand } from '../../.shared/lib/exec.ts';

runCheck(() =>
  verifyChecklist(
    runCommand,
    required(process.env.INPUTS_CHANGE_DIR, 'change_dir'),
    join(artifactsDir(), 'planned-checklist.md')
  )
);
