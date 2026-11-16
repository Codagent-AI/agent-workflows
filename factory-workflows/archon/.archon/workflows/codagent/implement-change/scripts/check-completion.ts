import { checkCompletion } from '../../.shared/lib/completion.ts';
import { completionInput } from '../../.shared/lib/completion-run.ts';
import { script } from '../../.shared/lib/review-files.ts';
script(() => {
  const input = completionInput({ changeDir: process.env.INPUTS_CHANGE_DIR, start: process.env.INPUTS_START,
    blocked: process.env.INPUTS_BLOCKED === 'true' || process.env.INPUTS_INITIAL_BLOCKED === 'true' ? 'true' : 'false', previous: process.env.INPUTS_PREVIOUS });
  return { ...checkCompletion(input), iteration: Number(input.judgment), start: input.start };
});
