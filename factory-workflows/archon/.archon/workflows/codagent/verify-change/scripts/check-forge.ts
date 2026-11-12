// Refuses the run before any agent spends when the forge plugin or its credential is missing.
import { requireOk } from '../../.shared/lib/check.ts';
import { runCommand } from '../../.shared/lib/exec.ts';
import { checkForgeAccess } from '../../.shared/lib/forge.ts';

const { message, ...result } = checkForgeAccess(runCommand, process.env);
requireOk(result, message);
