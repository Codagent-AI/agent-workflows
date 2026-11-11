import { required, runCheck } from '../../.shared/lib/check.ts';
import { runCommand } from '../../.shared/lib/exec.ts';
import { checkCommitsSince } from '../../.shared/lib/worktree.ts';

runCheck(() => checkCommitsSince(runCommand, required(process.env.INPUTS_START_HEAD, 'start_head')));
