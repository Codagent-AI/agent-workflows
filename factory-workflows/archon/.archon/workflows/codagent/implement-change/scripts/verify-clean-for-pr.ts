import { runCheck } from '../../.shared/lib/check.ts';
import { runCommand } from '../../.shared/lib/exec.ts';
import { checkWorktreeClean } from '../../.shared/lib/worktree.ts';

runCheck(() =>
  checkWorktreeClean(
    runCommand,
    'working tree changes remain after validation; commit or remove them before opening the draft pull request'
  )
);
