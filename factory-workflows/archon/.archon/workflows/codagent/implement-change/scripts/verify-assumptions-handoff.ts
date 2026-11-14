// The assumptions ledger is the canonical handoff for the first phase of human acceptance.
import { join } from 'node:path';

import { artifactsDir, fail, pass, runCheck } from '../../.shared/lib/check.ts';
import { ARTIFACTS, nonEmptyFile } from '../../.shared/lib/artifacts.ts';

runCheck(() => {
  const ledger = join(artifactsDir(), ARTIFACTS.assumptions);
  return nonEmptyFile(ledger) ? pass() : fail(`${ledger} is missing or empty`);
});
