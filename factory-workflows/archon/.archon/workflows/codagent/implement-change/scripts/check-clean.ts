import { checkMode, report, stopIfBlocked } from '../../.shared/lib/check.ts';
import { runCommand } from '../../.shared/lib/exec.ts';
import { checkTrackedClean } from '../../.shared/lib/worktree.ts';

const mode = checkMode();
stopIfBlocked(mode);
report(checkTrackedClean(runCommand, 'tracked files have uncommitted changes:'), mode);
