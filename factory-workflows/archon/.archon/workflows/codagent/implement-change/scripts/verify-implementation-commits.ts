// Implementation must leave at least one commit since `start`, where the implement step
// started, from Archon's checkout observation.
import { artifactsDir, required, runCheck } from '../../.shared/lib/check.ts';
import { checkoutStart } from '../../.shared/lib/checkout.ts';
import { runCommand } from '../../.shared/lib/exec.ts';
import { checkCommitsSince } from '../../.shared/lib/worktree.ts';

runCheck(() => {
  const observed = checkoutStart(required(process.env.INPUTS_START, 'start'), artifactsDir(), false);
  return 'failure' in observed ? observed.failure : checkCommitsSince(runCommand, observed.start.commit);
});
