// The tester has read any retest reason; a stale one must not keep the rounds going after
// the next fix.
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { artifactsDir } from '../../.shared/lib/check.ts';
import { FILES } from '../../.shared/lib/acceptance.ts';

rmSync(join(artifactsDir(), FILES.retestReason), { force: true });
process.stdout.write('cleared\n');
