// The convergence gate. It never fails: a round that has not converged is fixed, unless it
// is the last round, which ends the rounds with the findings for the handoff.
import { artifactsDir, required } from '../../.shared/lib/check.ts';
import { checkGate } from '../../.shared/lib/acceptance.ts';
import { runCommand } from '../../.shared/lib/exec.ts';

const gate = checkGate(runCommand, artifactsDir(), required(process.env.INPUTS_LAST, 'last') === 'true');
if (gate.reasons) process.stderr.write(`acceptance has not converged:\n${gate.reasons}\n`);
process.stdout.write(`${JSON.stringify(gate)}\n`);
