// write-acceptance-status writes both files just before this check, so a failure reruns
// that step rather than letting an agent write or declare the outcome.
import { artifactsDir, checkMode, fail, pass, report } from '../../.shared/lib/check.ts';
import { handoffProblems } from '../../.shared/lib/acceptance.ts';

const problems = handoffProblems(artifactsDir());
report(problems.length === 0 ? pass() : fail(problems), checkMode());
