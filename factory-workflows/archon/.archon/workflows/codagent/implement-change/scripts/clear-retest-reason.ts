// A stale reason must not keep the rounds going after the next fix.
import { clearRetestReason } from '../../.shared/lib/acceptance.ts';
import { artifactsDir } from '../../.shared/lib/check.ts';

clearRetestReason(artifactsDir());
process.stdout.write('cleared\n');
