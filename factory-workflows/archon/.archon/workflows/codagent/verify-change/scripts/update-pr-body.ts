// Puts the description open-draft-pr wrote to pr-body.md into the open pull request's body,
// between the generated-body markers, keeping what a human added outside them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { artifactsDir, fail, runCheck } from '../../.shared/lib/check.ts';
import { ARTIFACTS } from '../../.shared/lib/artifacts.ts';
import { runCommand } from '../../.shared/lib/exec.ts';
import { updateGeneratedBody } from '../../.shared/lib/pull-request.ts';

runCheck(() => {
  const file = join(artifactsDir(), ARTIFACTS.prBody);
  try {
    return updateGeneratedBody(runCommand, readFileSync(file, 'utf8'));
  } catch {
    return fail(`${file} is missing`);
  }
});
