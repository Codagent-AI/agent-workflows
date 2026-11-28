// Checks this round's evidence records as the review page will read them, so the tester can
// correct a bad record in the handoff instead of the page leaving it out. It never fails.
import { artifactsDir, required } from '../../.shared/lib/check.ts';
import { roundProblems } from '../../.shared/lib/review-media.ts';

const problems = roundProblems(artifactsDir(), Number(required(process.env.INPUTS_ROUND, 'round')));
process.stdout.write(`${JSON.stringify({ problems })}\n`);
