import { checkVerdict, type Verdict } from '../../.shared/lib/completion.ts';
import { completionInput } from '../../.shared/lib/completion-run.ts';
import { script } from '../../.shared/lib/review-files.ts';
script(() => {
  const input = completionInput({ changeDir: process.env.INPUTS_CHANGE_DIR, start: process.env.INPUTS_START,
    blocked: 'false', previous: String(Number(process.env.INPUTS_ITERATION) - 1) });
  const raw = process.env.INPUTS_RESULT;
  let verdict: Verdict | null = null;
  try { verdict = raw ? JSON.parse(raw) as Verdict : null; }
  catch { throw new Error('judge returned no valid verdict: malformed JSON'); }
  return { ...checkVerdict(input, verdict), iteration: Number(input.judgment) };
});
