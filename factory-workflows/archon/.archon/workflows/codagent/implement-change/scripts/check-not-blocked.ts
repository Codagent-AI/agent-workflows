// Fails, printing the record, when an agent wrote the blocked record because only the user
// can settle a question about the approved definition.
import { artifactsDir, requireOk } from '../../.shared/lib/check.ts';
import { checkNotBlocked } from '../../.shared/lib/worktree.ts';

requireOk(checkNotBlocked(artifactsDir()), 'not blocked');
