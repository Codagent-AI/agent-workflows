import { artifactsDir } from '../../.shared/lib/check.ts';
import { readState, recordReviewed, saveHandoff, saveResult, script } from '../../.shared/lib/review-files.ts';
import { findingText, settled } from '../../.shared/lib/review.ts';

script(() => {
  const dir = artifactsDir();
  const state = readState(dir);
  recordReviewed(state, process.env, process.env.INPUTS_MODE === 'feedback');
  saveResult(dir, state);
  if (process.env.INPUTS_MODE === 'tail') saveHandoff(dir, state);
  return { settled: settled(state), findings: findingText(state) };
});
