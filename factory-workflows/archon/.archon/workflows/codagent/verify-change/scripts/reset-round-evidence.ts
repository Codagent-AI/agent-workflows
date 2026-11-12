// Starts an acceptance round: clears the previous round's status and handoff, and numbers
// the round from the previous iteration's number.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { ARTIFACTS } from '../../.shared/lib/artifacts.ts';
import { artifactsDir, required } from '../../.shared/lib/check.ts';
import { startRound } from '../../.shared/lib/acceptance.ts';

const dir = artifactsDir();
mkdirSync(join(dir, ARTIFACTS.testerScratch), { recursive: true });
const round = startRound(
  dir,
  required(process.env.INPUTS_PREVIOUS_ROUND, 'previous_round'),
  Number(required(process.env.INPUTS_ROUNDS, 'rounds'))
);
process.stdout.write(`${JSON.stringify(round)}\n`);
