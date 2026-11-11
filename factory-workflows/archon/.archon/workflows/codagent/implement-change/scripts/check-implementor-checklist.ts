// The checklist step must leave only the checklist behind: no commits and no other changes.
// The check then commits the checklist, so implementation starts from a committed checklist.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { artifactsDir, requireOk, required } from '../../.shared/lib/check.ts';
import { checkImplementorChecklist } from '../../.shared/lib/checklist.ts';
import { runCommand } from '../../.shared/lib/exec.ts';

requireOk(
  checkImplementorChecklist(runCommand, {
    changeDir: required(process.env.INPUTS_CHANGE_DIR, 'change_dir'),
    changeName: required(process.env.INPUTS_CHANGE_NAME, 'change_name'),
    definitionHead: required(process.env.INPUTS_DEFINITION_HEAD, 'definition_head'),
    preListStatus: readFileSync(join(artifactsDir(), 'pre-list-status.txt'), 'utf8'),
  }),
  'checklist committed'
);
