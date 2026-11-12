import { requireOk } from '../../.shared/lib/check.ts';
import { runCommand } from '../../.shared/lib/exec.ts';
import { checkTrackedClean } from '../../.shared/lib/worktree.ts';

requireOk(
  checkTrackedClean(
    runCommand,
    'tracked worktree changes exist before implementation; commit or remove them before continuing'
  ),
  'no tracked changes'
);
