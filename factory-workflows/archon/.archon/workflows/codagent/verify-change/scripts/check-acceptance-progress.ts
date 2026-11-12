// Decides whether the round pushes the lead's fix for another tester round. With
// stop_unchanged_acceptance, a fix that moved nothing and gave no retest reason ends the rounds.
import { artifactsDir, required } from '../../.shared/lib/check.ts';
import { checkProgress } from '../../.shared/lib/acceptance.ts';
import { runCommand } from '../../.shared/lib/exec.ts';

const progress = checkProgress(
  runCommand,
  artifactsDir(),
  required(process.env.INPUTS_FIX, 'fix') === 'true',
  required(process.env.INPUTS_STOP_UNCHANGED, 'stop_unchanged') === 'true'
);
if (!progress.progressed) {
  process.stderr.write(
    'the acceptance fix left the tested revision unchanged and gave no retest reason; ending the acceptance rounds\n'
  );
}
process.stdout.write(`${JSON.stringify(progress)}\n`);
