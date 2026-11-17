import { finishRun } from '../../.shared/lib/finish-run.ts';
finishRun({ op: process.env.INPUTS_OP ?? '', name: process.env.INPUTS_CHANGE_NAME ?? '',
  folder: process.env.INPUTS_CHANGE_FOLDER ?? '', blocked: process.env.INPUTS_BLOCKED === 'true' || process.env.INPUTS_PREVIOUS_BLOCKED === 'true',
  reason: process.env.INPUTS_REASON ?? '', result: process.env.INPUTS_RESULT ?? '',
  previous: process.env.INPUTS_PREVIOUS ?? '', status: process.env.INPUTS_STATUS ?? '', step: process.env.INPUTS_STEP ?? '',
  finish: process.env.INPUTS_STOP_AFTER !== 'acceptance' });
