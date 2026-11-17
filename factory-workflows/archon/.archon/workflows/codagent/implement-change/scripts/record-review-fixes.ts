import { artifactsDir, required } from '../../.shared/lib/check.ts';
import { head, readState, result, saveState, script } from '../../.shared/lib/review-files.ts';
import { applyActions, currentCycle, findingText, type Action } from '../../.shared/lib/review.ts';

script(() => {
  const dir = artifactsDir();
  const state = readState(dir);
  const name = required(process.env.INPUTS_REVIEW_NAME, 'review_name');
  const output = result<{ blocked: boolean; reason: string; actions: Action[] }>(process.env.INPUTS_RESULT, name);
  applyActions(state, output.actions);
  currentCycle(state).blocked = output.blocked ? output.reason || 'the fixer gave no reason' : '';
  saveState(dir, state);
  return { blocked: output.blocked, start: state.last_reviewed, end: head(), findings: findingText(state) };
});
