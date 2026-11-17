// Fails, printing the record or the step's reason, when the step before it wrote the blocked
// record or returned `blocked: true`, because only the user can settle a question about the
// approved definition.
import { artifactsDir, requireOk } from '../../.shared/lib/check.ts';
import { checkNotBlocked } from '../../.shared/lib/worktree.ts';

const returned = { blocked: process.env.INPUTS_BLOCKED === 'true', reason: process.env.INPUTS_REASON ?? '' };
requireOk(checkNotBlocked(artifactsDir(), returned), 'not blocked');
