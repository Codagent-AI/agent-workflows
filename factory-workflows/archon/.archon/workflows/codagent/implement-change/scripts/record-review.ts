import { artifactsDir } from '../../.shared/lib/check.ts';
import { runCommand } from '../../.shared/lib/exec.ts';
import { readState, recordReviewed, saveHandoff, saveResult, script } from '../../.shared/lib/review-files.ts';
import { markReviewed, markReviewRoundDone } from '../../.shared/lib/review-revisions.ts';
import { currentCycle, findingText, settled } from '../../.shared/lib/review.ts';

script(() => {
  const dir = artifactsDir();
  const state = readState(dir);
  recordReviewed(state, process.env, process.env.INPUTS_MODE === 'feedback');
  saveResult(dir, state);
  // The reviewer has now read the commits sent to a review round; its findings stay open on their own.
  if (process.env.INPUTS_MODE === 'feedback' && process.env.INPUTS_NEEDED !== 'false') markReviewRoundDone(dir);
  if (process.env.INPUTS_MODE === 'tail') saveHandoff(dir, state);
  // A CI fix reviewed in its own cycle is not left to the person as a late commit.
  if (process.env.INPUTS_PLACE === 'finalize') markReviewed(runCommand, dir, currentCycle(state).start, currentCycle(state).end);
  return { settled: settled(state), findings: findingText(state) };
});
