// The assumptions ledger is the canonical handoff for the first phase of human acceptance.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { artifactsDir, fail, pass, runCheck } from '../../.shared/lib/check.ts';
import { ARTIFACTS } from '../../.shared/lib/artifacts.ts';

runCheck(() => {
  const ledger = join(artifactsDir(), ARTIFACTS.assumptions);
  return existsSync(ledger) && statSync(ledger).size > 0 ? pass() : fail(`${ledger} is missing or empty`);
});
