// Waits up to max_minutes for current-head CI on the pull request and writes the report
// for the tester's handoff to ci/round-<n>.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ARTIFACTS } from '../../.shared/lib/artifacts.ts';
import { artifactsDir, required } from '../../.shared/lib/check.ts';
import { renderReport } from '../../.shared/lib/ci-report.ts';
import { waitForCi } from '../../.shared/lib/ci.ts';
import { runCommand, sleep } from '../../.shared/lib/exec.ts';

const round = required(process.env.INPUTS_ROUND, 'round');
const result = waitForCi(runCommand, sleep, {
  maxMinutes: Number(required(process.env.INPUTS_MAX_MINUTES, 'max_minutes')),
  intervalSeconds: Number(required(process.env.INPUTS_INTERVAL_SECONDS, 'interval_seconds')),
});
const dir = join(artifactsDir(), ARTIFACTS.ciDir);
mkdirSync(dir, { recursive: true });
const reportFile = join(dir, `round-${round}.md`);
writeFileSync(reportFile, renderReport(result));
process.stdout.write(
  `${JSON.stringify({ status: result.status, had_checks: result.hadChecks, head_moved: result.headMoved, report: reportFile })}\n`
);
