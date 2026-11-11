// The branch has exactly one open draft pull request whose head is local HEAD. A brief
// GitHub lag retries here instead of rerunning the agent.
import { required, runCheck } from '../../.shared/lib/check.ts';
import { runCommand, sleep } from '../../.shared/lib/exec.ts';
import { checkDraftPr } from '../../.shared/lib/pull-request.ts';

runCheck(() => {
  const attempts = Number(required(process.env.INPUTS_ATTEMPTS, 'attempts'));
  const { prUrl, ...result } = checkDraftPr(runCommand, sleep, attempts, 3);
  return { ...result, pr_url: prUrl };
});
