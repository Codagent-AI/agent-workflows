import { type CheckResult, fail, pass } from './check.ts';
import { type Exec, type Sleep, sleep as wait } from './exec.ts';

export type PushResult = CheckResult & { person: boolean };

const transient = /ETIMEDOUT|timed? out|could not resolve host|connection reset|RPC failed|early EOF|remote end hung up unexpectedly|(?:returned error:|HTTP(?:\/\S+)?) 5\d\d|internal server error|bad gateway|service unavailable/i;
const credentials = /authentication failed|could not read username|invalid username or password|terminal prompts disabled|permission denied \(publickey\)|returned error: 40[13]/i;
const workflowScope = /refusing to allow[^\n]*workflow/i;
const retryDelays = [10_000, 30_000, 90_000];

function personFailure(detail: string): string {
  if (workflowScope.test(detail)) {
    return "GitHub refused the push because it changes .github/workflows and the token lacks the workflow scope. Push with a token that has it, then resume the run.";
  }
  if (credentials.test(detail)) {
    return 'GitHub refused the push because the credentials are expired, invalid or lack access. Log in again, then resume the run.';
  }
  return '';
}

// Git reports the pre-push hook's exit in Trace2 even when its own output looks like a network error.
function pushDiagnostic(stderr: string) {
  const hooks = new Set<string>();
  let failedHook = false;
  const diagnostics = stderr.split('\n').filter(line => {
    if (!line.startsWith('{"event":')) return true;
    try {
      const event = JSON.parse(line);
      const child = `${event.sid}:${event.child_id}`;
      if (event.event === 'child_start' && event.hook_name === 'pre-push') hooks.add(child);
      if (event.event === 'child_exit' && hooks.delete(child) && event.code !== 0) failedHook = true;
      return !event.sid;
    } catch { return true; }
  });
  return { stderr: diagnostics.join('\n').trim(), failedHook: failedHook || hooks.size > 0 };
}

function networkFailure(command: string, result: ReturnType<Exec>, exhausted: boolean): PushResult | undefined {
  const diagnostic = command === 'push' ? pushDiagnostic(result.stderr) : { stderr: result.stderr.trim(), failedHook: false };
  const detail = [result.stdout.trim(), diagnostic.stderr].filter(Boolean).join('\n');
  if (diagnostic.failedHook) return { ...fail(detail || 'pre-push hook failed'), person: false };
  const person = personFailure(detail);
  if (person) return { ...fail(person), person: true };
  if (!transient.test(detail)) return { ...fail(detail || `git ${command} exited ${result.status}`), person: false };
  if (exhausted) return { ...fail(`GitHub was unavailable after 3 retries: ${detail.split('\n').at(-1)}. Resume the run when GitHub is back.`), person: true };
  return undefined;
}

export function gitNetwork(exec: Exec, args: string[], sleep: Sleep = wait): PushResult {
  const env = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', ...(args[0] === 'push' && { GIT_TRACE2_EVENT: '2' }) };
  for (const delay of [...retryDelays, 0]) {
    const result = exec('git', args, { timeout: 300_000, env });
    if (result.status === 0) return { ...pass(), person: false };
    const failure = networkFailure(args[0], result, delay === 0);
    if (failure) return failure;
    sleep(delay);
  }
  throw new Error('Git retry loop exhausted without a result');
}
