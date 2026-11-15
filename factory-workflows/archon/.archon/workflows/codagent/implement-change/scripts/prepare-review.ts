import { artifactsDir, required } from '../../.shared/lib/check.ts';
import { checkoutStart } from '../../.shared/lib/checkout.ts';
import { git, head, readState, saveState, script } from '../../.shared/lib/review-files.ts';
import { activeFindings, findingText, handedOff, startCycle, type Place, type ReviewState } from '../../.shared/lib/review.ts';

// The first range starts where the implementor checklist started, which Archon records as a checkout
// observation; later ranges start at the last reviewed revision.
function startRevision(mode: string, dir: string, state: ReviewState): string {
  if (mode !== 'initial') return state.last_reviewed;
  const observed = checkoutStart(required(process.env.INPUTS_START, 'start'), dir, false);
  if ('failure' in observed) throw new Error(`prepare-review: ${observed.failure.problems}`);
  return observed.start.commit;
}

script(() => {
  const dir = artifactsDir();
  const state = readState(dir);
  const mode = required(process.env.INPUTS_MODE, 'mode');
  const place = required(process.env.INPUTS_PLACE, 'place') as Place;
  const changeDir = required(process.env.INPUTS_CHANGE_DIR, 'change_dir');
  const start = startRevision(mode, dir, state);
  if (!start) throw new Error('prepare-review: the start revision is empty');
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
