// Converts the branch's pull request back to draft after the acceptance fixes were pushed.
import { runCheck } from '../../.shared/lib/check.ts';
import { defaultTools } from '../../.shared/lib/forge.ts';
import { restoreDraft } from '../../.shared/lib/pull-request.ts';

runCheck(() => restoreDraft(defaultTools()));
