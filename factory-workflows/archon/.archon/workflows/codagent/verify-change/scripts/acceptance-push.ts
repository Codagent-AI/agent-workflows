import { checkMode, report, stopIfBlocked } from '../../.shared/lib/check.ts';
import { runCommand } from '../../.shared/lib/exec.ts';
import { acceptancePush } from '../../.shared/lib/pull-request.ts';

const mode = checkMode();
stopIfBlocked(mode);
report(acceptancePush(runCommand), mode);
