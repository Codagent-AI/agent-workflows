// As check-evidence, after the audit: rows may be added, and a planned row may change only
// if an audit finding names its ID.
import { required, runCheck } from '../../.shared/lib/check.ts';
import { checkEvidenceRun } from '../../.shared/lib/evidence.ts';

runCheck(() =>
  checkEvidenceRun(required(process.env.INPUTS_CHANGE_DIR, 'change_dir'), required(process.env.INPUTS_FINDINGS, 'findings'))
);
