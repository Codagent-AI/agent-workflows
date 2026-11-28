import { artifactsDir } from '../../.shared/lib/check.ts';
import { runCommand } from '../../.shared/lib/exec.ts';
import { readState, recordReviewed, saveResult, script } from '../../.shared/lib/review-files.ts';
import { markReviewed } from '../../.shared/lib/review-revisions.ts';
import { currentCycle, findingText, settled } from '../../.shared/lib/review.ts';

script(() => {
  const dir = artifactsDir();
  const state = readState(dir);
  const blocked = process.env.INPUTS_BLOCKED === 'true';
  if (!blocked) recordReviewed(state, process.env, true);
  // The re-review read the fixer's commits too, unless the fixer was blocked and it did not run.
  if (process.env.INPUTS_PLACE === 'finalize') markReviewed(runCommand, dir, currentCycle(state).start, currentCycle(state).end);
  saveResult(dir, state);
  return { stop: blocked || settled(state), findings: findingText(state) };
});
