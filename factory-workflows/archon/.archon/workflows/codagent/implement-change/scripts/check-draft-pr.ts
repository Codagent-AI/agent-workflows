// The branch has exactly one open draft pull request whose head is local HEAD. A brief
// forge lag retries here instead of rerunning the agent. The pull request it found is
// written to pull-request.json for the tester.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { ARTIFACTS } from '../../.shared/lib/artifacts.ts';
import { artifactsDir, required, runCheck } from '../../.shared/lib/check.ts';
import { sleep } from '../../.shared/lib/exec.ts';
import { defaultTools } from '../../.shared/lib/forge.ts';
import { checkDraftPr } from '../../.shared/lib/pull-request.ts';

runCheck(() => {
  const attempts = Number(required(process.env.INPUTS_ATTEMPTS, 'attempts'));
  const intervalSeconds = Number(required(process.env.INPUTS_INTERVAL_SECONDS, 'interval_seconds'));
  const { prUrl, pr, ...result } = checkDraftPr(defaultTools(), sleep, attempts, intervalSeconds);
  if (pr !== undefined) {
    const file = join(artifactsDir(), ARTIFACTS.pullRequest);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(pr, null, 2)}\n`);
  }
  return { ...result, pr_url: prUrl };
});
