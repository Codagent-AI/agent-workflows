// Snapshots the worktree so check-implementor-checklist can tell what the checklist step
// changed, and records the definition's commit.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { artifactsDir, fail, requireOk } from '../../.shared/lib/check.ts';
import { runCommand } from '../../.shared/lib/exec.ts';
import { head, status } from '../../.shared/lib/worktree.ts';

const before = status(runCommand, ['--untracked-files=all']);
const commit = head(runCommand);
if (before === undefined || commit === undefined) requireOk(fail('could not read the worktree state'), '');
writeFileSync(join(artifactsDir(), 'pre-list-status.txt'), before ? `${before}\n` : '');
process.stdout.write(`${JSON.stringify({ head: commit })}\n`);
