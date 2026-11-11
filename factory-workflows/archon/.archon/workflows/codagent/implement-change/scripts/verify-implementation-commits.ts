import { checkMode, report, required, stopIfBlocked } from '../../.shared/lib/check.ts';
import { runCommand } from '../../.shared/lib/exec.ts';
import { checkCommitsSince } from '../../.shared/lib/worktree.ts';

const mode = checkMode();
stopIfBlocked(mode);
report(checkCommitsSince(runCommand, required(process.env.INPUTS_START_HEAD, 'start_head')), mode);
