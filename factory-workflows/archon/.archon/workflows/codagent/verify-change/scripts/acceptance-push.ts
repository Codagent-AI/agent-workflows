import { runCheck } from '../../.shared/lib/check.ts';
import { runCommand } from '../../.shared/lib/exec.ts';
import { acceptancePush } from '../../.shared/lib/pull-request.ts';

runCheck(() => acceptancePush(runCommand));
