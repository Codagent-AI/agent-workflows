// As check-evidence, after the audit: rows may be added, and a planned row may change only
// if an audit finding names its ID.
import { required } from '../../.shared/lib/check.ts';
import { runEvidenceScript } from '../../.shared/lib/evidence.ts';

runEvidenceScript(() => ({
  changeDir: required(process.env.INPUTS_CHANGE_DIR, 'change_dir'),
  findings: required(process.env.INPUTS_FINDINGS, 'findings'),
}));
