// Run by the open-draft-pr agent: bun update-pr-body.ts <number> <marked-block-file>.
// Replaces the generated block in the pull request's body, keeping human additions.
import { readFileSync } from 'node:fs';

import { requireOk } from '../../.shared/lib/check.ts';
import { runCommand } from '../../.shared/lib/exec.ts';
import { updatePrBody } from '../../.shared/lib/pull-request.ts';

const [number, file] = process.argv.slice(2);
if (number === undefined || file === undefined) {
  process.stderr.write('usage: update-pr-body.ts <pr-number> <marked-block-file>\n');
  process.exit(2);
}
requireOk(updatePrBody(runCommand, number, readFileSync(file, 'utf8')), `updated pull request ${number} body`);
