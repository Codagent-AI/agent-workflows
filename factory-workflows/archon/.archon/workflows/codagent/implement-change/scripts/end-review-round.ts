import { artifactsDir, required } from '../../.shared/lib/check.ts';
import { assertHead, readState, result, saveResult, script } from '../../.shared/lib/review-files.ts';
import { addFindings, applyVerdicts, currentCycle, findingText, settled, type Defect, type Verdict } from '../../.shared/lib/review.ts';

script(() => {
  const dir = artifactsDir();
  const state = readState(dir);
  const blocked = process.env.INPUTS_BLOCKED === 'true';
  if (!blocked) {
    const name = required(process.env.INPUTS_REVIEW_NAME, 'review_name');
    const end = required(process.env.INPUTS_END, 'end');
    assertHead(end, name);
    const output = result<{ verdicts: Verdict[]; findings: Defect[] }>(process.env.INPUTS_RESULT, name);
    applyVerdicts(state, output.verdicts);
    addFindings(state, output.findings);
    state.last_reviewed = end;
    currentCycle(state).end = end;
  }
  saveResult(dir, state);
  return { stop: blocked || settled(state), findings: findingText(state) };
});
