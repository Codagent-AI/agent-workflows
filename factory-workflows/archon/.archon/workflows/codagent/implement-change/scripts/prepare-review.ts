import { artifactsDir, required } from '../../.shared/lib/check.ts';
import { git, head, readState, saveState, script } from '../../.shared/lib/review-files.ts';
import { activeFindings, findingText, handedOff, startCycle, type Place } from '../../.shared/lib/review.ts';

script(() => {
  const dir = artifactsDir();
  const state = readState(dir);
  const mode = required(process.env.INPUTS_MODE, 'mode');
  const place = required(process.env.INPUTS_PLACE, 'place') as Place;
  const changeDir = required(process.env.INPUTS_CHANGE_DIR, 'change_dir');
  const start = mode === 'initial' ? required(process.env.INPUTS_START, 'start') : state.last_reviewed;
  if (!start) throw new Error('prepare-review: implementor start revision is empty');
  try { git(['rev-parse', '--verify', `${start}^{commit}`]); }
  catch (error) { throw new Error(`prepare-review: cannot read start revision ${start}: ${String(error)}`); }
  const end = head();
  const range = mode === 'acceptance' ? start : `${start}..${end}`;
  const files = git(['diff', '--name-only', range, '--', '.', `:(exclude)${changeDir}`]);
  if (mode !== 'tail' || start !== end) {
    startCycle(state, { place, start, end, round: Number(process.env.INPUTS_ROUND ?? '0') });
    saveState(dir, state);
  }
  const needed = mode === 'tail' ? start !== end : files !== '' || activeFindings(state).length > 0;
  return { needed, start, end, files,
    findings: findingText(state), handed_off: handedOff(state) };
});
