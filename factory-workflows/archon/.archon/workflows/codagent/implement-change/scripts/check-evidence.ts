// Checks that the checklist is complete before the audit. In the repair loop it first
// stops on a blocked repair or a blocked record.
import { required } from '../../.shared/lib/check.ts';
import { runEvidenceScript } from '../../.shared/lib/evidence.ts';

runEvidenceScript(() => ({ changeDir: required(process.env.INPUTS_CHANGE_DIR, 'change_dir') }));
