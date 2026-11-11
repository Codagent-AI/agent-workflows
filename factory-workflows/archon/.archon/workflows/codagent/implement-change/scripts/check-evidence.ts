// Checks that the checklist is complete before the audit. It first stops on a blocked repair
// or a blocked record.
import { required, runCheck } from '../../.shared/lib/check.ts';
import { checkEvidenceRun } from '../../.shared/lib/evidence.ts';

runCheck(() => checkEvidenceRun(required(process.env.INPUTS_CHANGE_DIR, 'change_dir')));
