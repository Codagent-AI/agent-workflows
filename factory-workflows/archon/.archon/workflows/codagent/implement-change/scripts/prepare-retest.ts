import { join } from 'node:path';
import { startRound } from '../../.shared/lib/acceptance.ts';
import { artifactsDir, required } from '../../.shared/lib/check.ts';
import { readText, writeText } from '../../.shared/lib/run-files.ts';

const dir = artifactsDir();
const review = required(process.env.INPUTS_REVIEW_ROUND, 'review_round');
const marker = join(dir, 'review', `retest-round-${review}.txt`);
const previous = join(dir, 'acceptance-round-number.txt');
const recorded = readText(marker).trim();
const next = recorded || String(Number(readText(previous).trim() || '-1') + 1);
startRound(dir, String(Number(next) - 1), Number(next) + 1);
writeText(marker, next);
writeText(previous, next);
process.stdout.write(`${JSON.stringify({ round: Number(next) })}\n`);
