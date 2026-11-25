import { artifactsDir } from '../../.shared/lib/check.ts';
import { readState, recordReviewed, saveResult, script } from '../../.shared/lib/review-files.ts';
import { findingText, settled } from '../../.shared/lib/review.ts';

script(() => {
  const dir = artifactsDir();
  const state = readState(dir);
  const blocked = process.env.INPUTS_BLOCKED === 'true';
  if (!blocked) recordReviewed(state, process.env, true);
  saveResult(dir, state);
  return { stop: blocked || settled(state), findings: findingText(state) };
});
