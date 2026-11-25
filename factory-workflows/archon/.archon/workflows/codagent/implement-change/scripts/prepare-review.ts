import { artifactsDir, required } from '../../.shared/lib/check.ts';
import { join } from 'node:path';
import { readJson, readText } from '../../.shared/lib/run-files.ts';
import { responsePath } from '../../.shared/lib/review-round.ts';
import { feedbackFiles } from '../../.shared/lib/review-revisions.ts';
import { runCommand } from '../../.shared/lib/exec.ts';
import { checkoutStart } from '../../.shared/lib/checkout.ts';
import { git, head, readState, saveState, script } from '../../.shared/lib/review-files.ts';
import { activeFindings, findingText, handedOff, reopenRequested, startCycle, type Place, type ReviewState } from '../../.shared/lib/review.ts';

// The first range starts where the implementor checklist started, which Archon records as a checkout
// observation; later ranges start at the last reviewed revision.
function startRevision(mode: string, dir: string, state: ReviewState): string {
  if (mode === 'feedback') return process.env.INPUTS_START || state.last_reviewed;
  if (mode !== 'initial') return state.last_reviewed;
  const observed = checkoutStart(required(process.env.INPUTS_START, 'start'), dir, false);
  if ('failure' in observed) throw new Error(`prepare-review: ${observed.failure.problems}`);
  return observed.start.commit;
}

function requestedFixes(path: string, folder: string, dir: string): string {
  if (!path) return '';
  const answer = readJson<{ round?: number; answers?: { item: string; option: string }[] }>(path, {});
  const codes = new Set(answer.answers?.filter(choice => choice.option === 'fix').map(choice => choice.item));
  const log = ['decision-log.md', 'dispute-log.md'].map(name => readText(join(folder, name))).join('\n');
  const sections = log.split(/(?=^## )/m).filter(section => codes.has(/^## ([^:]+):/.exec(section)?.[1] ?? ''));
  const replies = readJson<{ requestedFindings?: string[] }[]>(responsePath(dir, answer.round ?? 0), []);
  const requested = replies.flatMap(entry => Array.isArray(entry.requestedFindings) ? entry.requestedFindings : []).filter(id => /^(?:REVIEW-\d+|R\d+)$/.test(id));
  return [...codes, ...sections, ...requested].join('\n');
}

function reviewFiles(mode: string, dir: string, range: { start: string; end: string; changeDir: string }): string {
  if (mode === 'feedback') return feedbackFiles(runCommand, dir, range.start, range.end);
  const diff = mode === 'acceptance' ? range.start : `${range.start}..${range.end}`;
  return git(['diff', '--name-only', diff, '--', '.', `:(exclude)${range.changeDir}`]);
}

function verifyStart(start: string): void {
  try { git(['rev-parse', '--verify', `${start}^{commit}`]); }
  catch (error) { throw new Error(`prepare-review: cannot read start revision ${start}: ${String(error)}`); }
}

script(() => {
  const dir = artifactsDir();
  const state = readState(dir);
  const mode = required(process.env.INPUTS_MODE, 'mode');
  const place = required(process.env.INPUTS_PLACE, 'place') as Place;
  const changeDir = required(process.env.INPUTS_CHANGE_DIR, 'change_dir');
  const start = startRevision(mode, dir, state);
  if (!start) throw new Error('prepare-review: the start revision is empty');
  verifyStart(start);
  const end = head();
  const files = reviewFiles(mode, dir, { start, end, changeDir });
  if (mode !== 'tail' || start !== end) {
    startCycle(state, { place, start, end, round: Number(process.env.INPUTS_ROUND ?? '0') });
    if (mode === 'feedback') {
      reopenRequested(state, requestedFixes(process.env.INPUTS_ANSWERS_FILE ?? '', changeDir, dir));
    }
    saveState(dir, state);
  }
  const needed = mode === 'tail' ? start !== end : files !== '' || activeFindings(state).length > 0;
  return { needed, start, end, files,
    findings: findingText(state), handed_off: handedOff(state) };
});
