// Validate all inputs before agents run; expose the typed values later nodes read.
import { readInputs, validateRun } from '../../.shared/lib/params.ts';

const inputs = readInputs(process.env);
validateRun(inputs, { rounds: Number(inputs.acceptanceRounds), review: inputs.reviewStrategy !== 'none' });
