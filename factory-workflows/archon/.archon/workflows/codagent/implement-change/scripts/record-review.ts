import { artifactsDir, required } from '../../.shared/lib/check.ts';
import { assertHead, readState, result, saveHandoff, saveResult, script } from '../../.shared/lib/review-files.ts';
import { addFindings, currentCycle, findingText, settled, type Defect } from '../../.shared/lib/review.ts';

script(() => {
  const dir = artifactsDir();
  const state = readState(dir);
  const end = required(process.env.INPUTS_END, 'end');
  const name = required(process.env.INPUTS_REVIEW_NAME, 'review_name');
  assertHead(end, name);
  const output = process.env.INPUTS_NEEDED === 'false' ? { findings: [] } : result<{ findings: Defect[] }>(process.env.INPUTS_RESULT, name);
  addFindings(state, output.findings);
  currentCycle(state).end = end;
  state.last_reviewed = end;
  saveResult(dir, state);
  if (process.env.INPUTS_MODE === 'tail') saveHandoff(dir, state);
  return { settled: settled(state), findings: findingText(state) };
});
