import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
function traceEvent(line: string): { event?: string; sid?: string; child_id?: number; hook_name?: string; code?: number } {
  if (!line.startsWith('{"event":')) return {};
  try { return JSON.parse(line); }
  catch { return {}; } // A timed-out push can leave a partial final trace line.
}

function hookFailed(trace: string) {
  const hooks = new Set<string>();
  for (const line of trace.split('\n')) {
    const event = traceEvent(line);
    const child = `${event.sid}:${event.child_id}`;
    if (event.event === 'child_start' && event.hook_name === 'pre-push') hooks.add(child);
    if (event.event === 'child_exit' && hooks.delete(child) && event.code !== 0) return true;
  }
  return hooks.size > 0;
}

function attempt(exec: Exec, args: string[]) {
  const env = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  if (args[0] !== 'push') return { result: exec('git', args, { timeout: 300_000, env }), failedHook: false };
  const folder = mkdtempSync(join(tmpdir(), 'archon-git-push-'));
  const trace = join(folder, 'trace.jsonl');
  try {
    const result = exec('git', args, { timeout: 300_000, env: { ...env, GIT_TRACE2_EVENT: trace } });
    let failedHook = false;
    if (result.status !== 0) {
      try { failedHook = hookFailed(readFileSync(trace, 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return { result, failedHook };
  } finally { rmSync(folder, { recursive: true, force: true }); }
}

function networkFailure(command: string, result: ReturnType<Exec>, exhausted: boolean, failedHook: boolean): PushResult | undefined {
  const detail = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
  if (failedHook) return { ...fail(detail || 'pre-push hook failed'), person: false };
  const person = personFailure(detail);
  if (person) return { ...fail(person), person: true };
  if (!transient.test(detail)) return { ...fail(detail || `git ${command} exited ${result.status}`), person: false };
  if (exhausted) return { ...fail(`GitHub was unavailable after 3 retries: ${detail.split('\n').at(-1)}. Resume the run when GitHub is back.`), person: true };
  return undefined;
}

export function gitNetwork(exec: Exec, args: string[], sleep: Sleep = wait): PushResult {
  for (const delay of [...retryDelays, 0]) {
    const { result, failedHook } = attempt(exec, args);
    if (result.status === 0) return { ...pass(), person: false };
    const failure = networkFailure(args[0], result, delay === 0, failedHook);
    if (failure) return failure;
    sleep(delay);
  }
  throw new Error('Git retry loop exhausted without a result');
}
