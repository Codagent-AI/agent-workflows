// Checks that the checklist is complete before the audit. In the repair loop it first
// stops on a blocked repair or a blocked record.
import { join } from 'node:path';

import { artifactsDir, checkMode, report, requireOk, required, stopIfBlocked } from '../../.shared/lib/check.ts';
import { checkEvidence, checklistPath } from '../../.shared/lib/checklist.ts';
import { checkNotBlocked } from '../../.shared/lib/worktree.ts';

const mode = checkMode();
stopIfBlocked(mode);
const dir = artifactsDir();
const notBlocked = checkNotBlocked(dir);
if (!notBlocked.ok) requireOk(notBlocked, '');
const result = checkEvidence({
  checklistFile: checklistPath(required(process.env.INPUTS_CHANGE_DIR, 'change_dir')),
  evidenceDir: join(dir, 'evidence'),
  problemsFile: join(dir, 'evidence-problems.txt'),
  planFile: join(dir, 'planned-checklist.md'),
});
report(result, mode);
