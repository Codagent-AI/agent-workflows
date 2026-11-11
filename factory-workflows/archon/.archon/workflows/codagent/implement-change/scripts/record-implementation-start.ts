// Recorded after the checklist commit, so that commit cannot satisfy the implementation check.
import { fail, requireOk } from '../../.shared/lib/check.ts';
import { runCommand } from '../../.shared/lib/exec.ts';
import { head } from '../../.shared/lib/worktree.ts';

const commit = head(runCommand);
if (commit === undefined) requireOk(fail('could not resolve HEAD'), '');
process.stdout.write(`${JSON.stringify({ head: commit })}\n`);
