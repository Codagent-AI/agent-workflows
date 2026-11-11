// Writes acceptance-preparation-status.txt and, when acceptance did not converge, a short
// acceptance-handoff.md. It reads both back and fails the node when either is wrong.
// Safe to rerun.
import { artifactsDir, fail, requireOk, required } from '../../.shared/lib/check.ts';
import { type Finalized, finalize } from '../../.shared/lib/acceptance.ts';
import { runCommand } from '../../.shared/lib/exec.ts';

let finalized: Finalized | undefined;
try {
  finalized = finalize(runCommand, artifactsDir(), required(process.env.INPUTS_ROUNDS, 'rounds'));
} catch (error) {
  requireOk(fail((error as Error).message), '');
}
process.stdout.write(`${finalized?.message ?? ''}\n`);
