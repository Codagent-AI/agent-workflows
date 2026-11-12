// The result every check script reports, and how a script ends with it.
//
// A check runs twice around a repair. The first run reports `{ok, problems}` and exits 0,
// so the workflow can route a failure to a repair agent. The recheck after the repair is
// the same script with the `strict`, `blocked` and `reason` bindings set:
//
//   - `blocked: true` from the repair agent fails the node with `REPAIR_BLOCKED: <reason>`
//     before anything is rechecked;
//   - `strict: true` fails the node when the check still fails.
//
// Every node that runs a check script binds all three (`strict: false`, `blocked: false` and
// `reason: ""` on the first run), and tests/params.test.ts checks that they do. The loader
// reads only a node's own script for `INPUTS_*` names and does not follow imports, so that
// test is what catches a misspelt binding.

export interface CheckResult {
  ok: boolean;
  problems: string;
}

export const pass = (): CheckResult => ({ ok: true, problems: '' });
export const fail = (problems: string | readonly string[]): CheckResult => ({
  ok: false,
  problems: typeof problems === 'string' ? problems : problems.join('\n'),
});

export interface CheckMode {
  strict: boolean;
  blocked: boolean;
  reason: string;
}

export function checkMode(): CheckMode {
  return {
    strict: process.env.INPUTS_STRICT === 'true',
    blocked: process.env.INPUTS_BLOCKED === 'true',
    reason: process.env.INPUTS_REASON ?? '',
  };
}

/** Ends the script when the repair agent reported itself blocked. */
function stopIfBlocked(mode: CheckMode): void {
  if (!mode.blocked) return;
  process.stderr.write(`REPAIR_BLOCKED: ${mode.reason.trim() || 'the repair agent gave no reason'}\n`);
  process.exit(1);
}

/** Prints the result as the node's output, failing the node on a strict failure. */
function report(result: CheckResult, mode: CheckMode, extra: Record<string, unknown> = {}): void {
  if (!result.ok && mode.strict) {
    process.stderr.write(`${result.problems}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: result.ok, problems: result.problems, ...extra })}\n`);
}

/**
 * The body of a check script. It stops on a blocked repair, runs the check and prints the
 * result. Any field of the result other than `ok` and `problems` is printed with them.
 */
export function runCheck(check: () => CheckResult): void {
  const mode = checkMode();
  stopIfBlocked(mode);
  const { ok, problems, ...extra } = check();
  report({ ok, problems }, mode, extra);
}

/** Ends a script that has no repair: success prints a line, failure fails the node. */
export function requireOk(result: CheckResult, success: string): void {
  if (!result.ok) {
    process.stderr.write(`${result.problems}\n`);
    process.exit(1);
  }
  process.stdout.write(`${success}\n`);
}

/** A required binding, failing the node when it is missing. */
export function required(value: string | undefined, name: string): string {
  if (value === undefined) {
    process.stderr.write(`missing input: ${name}\n`);
    process.exit(1);
  }
  return value;
}

export function artifactsDir(): string {
  return required(process.env.ARTIFACTS_DIR, 'ARTIFACTS_DIR');
}
