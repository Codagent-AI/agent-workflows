import { required } from '../../.shared/lib/check.ts';
import { responsePath } from '../../.shared/lib/completion-run.ts';
import { writeText } from '../../.shared/lib/run-files.ts';
writeText(responsePath(), required(process.env.INPUTS_RESULT, 'result'));
process.stdout.write('saved implementor response\n');
