// The tester has read any retest reason; a stale one must not keep the rounds going after
// the next fix.
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { artifactsDir } from '../../.shared/lib/check.ts';
import { ARTIFACTS } from '../../.shared/lib/artifacts.ts';

rmSync(join(artifactsDir(), ARTIFACTS.retestReason), { force: true });
process.stdout.write('cleared\n');
