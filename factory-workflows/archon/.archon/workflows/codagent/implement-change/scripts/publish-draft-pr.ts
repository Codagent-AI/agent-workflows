// Publishes the title and description open-draft-pr wrote: opens the branch's pull request
// as a draft, or puts the description into the open one's body between the generated-body
// markers, keeping what a human added outside them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ARTIFACTS } from '../../.shared/lib/artifacts.ts';
import { artifactsDir, fail, runCheck } from '../../.shared/lib/check.ts';
import { defaultTools } from '../../.shared/lib/forge.ts';
import { publishDraftPr } from '../../.shared/lib/pull-request.ts';

/** A file the agent wrote, or '' when it did not. */
function written(name: string): string {
  try {
    return readFileSync(join(artifactsDir(), name), 'utf8');
  } catch {
    return '';
  }
}

runCheck(() => {
  const block = written(ARTIFACTS.prBody);
  if (block === '') return fail(`${join(artifactsDir(), ARTIFACTS.prBody)} is missing`);
  return publishDraftPr(defaultTools(), { title: written(ARTIFACTS.prTitle), block });
});
