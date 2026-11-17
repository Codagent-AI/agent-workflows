import { endAcceptance } from '../../.shared/lib/finish-run.ts';
// Ends a round when its fix made no progress and gave no retest reason. A fix that returned
// `blocked: true` fails the run with its reason, as a blocked repair does.
import { artifactsDir, required } from '../../.shared/lib/check.ts';
import { checkProgress } from '../../.shared/lib/acceptance.ts';
import { runCommand } from '../../.shared/lib/exec.ts';

if (required(process.env.INPUTS_BLOCKED, 'blocked') === 'true') {
  endAcceptance(artifactsDir(), `Acceptance fix blocked: ${process.env.INPUTS_REASON || 'decision needed'}`);
  process.stdout.write(`${JSON.stringify({ progressed: false, push: false })}\n`);
  process.exit(0);
}
const progress = checkProgress(
  runCommand,
  artifactsDir(),
  required(process.env.INPUTS_FIX, 'fix') === 'true'
);
if (!progress.progressed) {
  process.stderr.write(
    'the acceptance fix left the tested revision unchanged and gave no retest reason; ending the acceptance rounds\n'
  );
}
process.stdout.write(`${JSON.stringify(progress)}\n`);
