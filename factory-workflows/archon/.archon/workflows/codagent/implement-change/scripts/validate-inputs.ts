// Checks every input the run passes on to verify-change before any other node, so a bad
// acceptance_rounds fails now and not after the whole implementation. Prints the change's
// folder and the sentence on validating an artifact, which every later node reads.
import { readInputs, validateRun } from '../../.shared/lib/params.ts';

validateRun(readInputs(process.env));
