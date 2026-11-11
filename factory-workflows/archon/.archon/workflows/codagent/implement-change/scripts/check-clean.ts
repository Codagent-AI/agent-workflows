import { runCheck } from '../../.shared/lib/check.ts';
import { runCommand } from '../../.shared/lib/exec.ts';
import { checkTrackedClean } from '../../.shared/lib/worktree.ts';

runCheck(() => checkTrackedClean(runCommand, 'tracked files have uncommitted changes:'));
