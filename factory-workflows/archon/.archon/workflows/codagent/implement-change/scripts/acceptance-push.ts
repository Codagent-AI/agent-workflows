import { artifactsDir, checkMode, runCheck } from '../../.shared/lib/check.ts';
import { runCommand } from '../../.shared/lib/exec.ts';
import { acceptancePush } from '../../.shared/lib/pull-request.ts';
import { endAcceptance } from '../../.shared/lib/finish-run.ts';
const mode = checkMode();
const result = mode.blocked ? { ok: false, problems: mode.reason } : acceptancePush(runCommand);
if (!result.ok && mode.onFailure === 'report') endAcceptance(artifactsDir(), `Acceptance push failed: ${result.problems}. The PR lacks the round's fix unless finalize pushed it.`);
runCheck(() => result);
