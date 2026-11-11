// Writes acceptance-preparation-status.txt and, when acceptance did not converge, a short
// acceptance-handoff.md. Safe to rerun.
import { artifactsDir, required } from '../../.shared/lib/check.ts';
import { finalize } from '../../.shared/lib/acceptance.ts';
import { runCommand } from '../../.shared/lib/exec.ts';

const finalized = finalize(runCommand, artifactsDir(), String(required(process.env.INPUTS_ROUNDS, 'rounds')));
process.stdout.write(`${finalized.message}\n`);
