import { checkMode, report, stopIfBlocked } from '../../.shared/lib/check.ts';
import { runCommand } from '../../.shared/lib/exec.ts';
import { checkWorktreeClean } from '../../.shared/lib/worktree.ts';

const mode = checkMode();
stopIfBlocked(mode);
report(
  checkWorktreeClean(
    runCommand,
    'working tree changes remain after validation; commit or remove them before opening the draft pull request'
  ),
  mode
);
