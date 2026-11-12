// Checks every input before any other node, and prints the typed values later nodes read.
import { readInputs, validateRun } from '../../.shared/lib/params.ts';

const inputs = readInputs(process.env);
validateRun(inputs, {
  rounds: Number(inputs.acceptanceRounds),
  review: inputs.skipImplementationReview === 'false',
  stop_unchanged: inputs.stopUnchangedAcceptance === 'true',
});
