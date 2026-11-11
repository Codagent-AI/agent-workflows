// The assumptions ledger is the canonical handoff for the first phase of human acceptance.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { artifactsDir, checkMode, fail, pass, report, stopIfBlocked } from '../../.shared/lib/check.ts';
import { FILES } from '../../.shared/lib/acceptance.ts';

const mode = checkMode();
stopIfBlocked(mode);
const ledger = join(artifactsDir(), FILES.assumptions);
report(existsSync(ledger) && statSync(ledger).size > 0 ? pass() : fail(`${ledger} is missing or empty`), mode);
