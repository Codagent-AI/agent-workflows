import { artifactsDir, checkMode } from '../../.shared/lib/check.ts';
import { runCommand } from '../../.shared/lib/exec.ts';
import { acceptancePush } from '../../.shared/lib/pull-request.ts';
import { endAcceptance } from '../../.shared/lib/finish-run.ts';

const mode = checkMode();
const result = acceptancePush(runCommand);
if (!result.ok && (result.person || mode.strict)) {
  const reason = [result.problems, mode.blocked && mode.reason].filter(Boolean).join('\n');
  endAcceptance(artifactsDir(), reason, true);
}
const { person, ...check } = result;
process.stdout.write(`${JSON.stringify({ ...check, person })}\n`);
