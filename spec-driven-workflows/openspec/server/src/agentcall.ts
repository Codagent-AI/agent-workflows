import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { childCommand, childEnv, chooseCrosscheck, type Cli, detectLead } from "./child.js";
import { type Context, logEvent, repoLogDir, repoRoot } from "./context.js";
import type { ToolText } from "./finish.js";
import { run, tail } from "./proc.js";
import { inProgressChanges, readState, writeState } from "./state.js";
import { CALL_STEPS, type StepId } from "./steps.js";

export const CROSSCHECK_AGENT = "crosscheck";
const MAX_RESPONSE_CHARS = 200_000;
const KILL_GRACE_MS = 10_000;

type Status = "running" | "succeeded" | "failed" | "canceled";

interface Call {
  id: string;
  cli: Cli;
  model?: string;
  effort: string;
  root: string;
  changeName: string;
  step: StepId;
  dir: string;
  startedAt: Date;
  endedAt?: Date;
  status: Status;
  child?: ChildProcess;
  done: Promise<void>;
  cancelRequested: boolean;
  fingerprintBefore?: string;
  workingTree?: "unchanged" | "changed" | "unknown";
  response?: string;
  costUsd?: number;
  error?: { code: string; message: string };
}

function errorText(code: string, message: string, extra: Record<string, unknown> = {}): ToolText {
  return { text: JSON.stringify({ error: { code, message }, ...extra }, null, 2), isError: true };
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;
}

/**
 * A fingerprint of the working tree: status, the tracked diff, and untracked file contents.
 * Used to report whether anything changed while a child ran.
 */
export async function workingTreeFingerprint(root: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const git = (...args: string[]) => run("git", args, { cwd: root, env });
  const status = await git("status", "--porcelain=v1", "-uall");
  if (status.code !== 0) {
    return undefined;
  }
  const diff = await git("diff", "HEAD", "--binary");
  const untracked = await git("ls-files", "-o", "--exclude-standard", "-z");
  const hash = createHash("sha256").update(status.stdout).update("\0").update(diff.stdout).update("\0");
  for (const file of untracked.stdout.split("\0").filter(Boolean).sort()) {
    hash.update(file).update("\0");
    try {
      const path = join(root, file);
      if (statSync(path).isFile()) {
        hash.update(readFileSync(path));
      }
    } catch {
      hash.update("<unreadable>");
    }
  }
  return hash.digest("hex");
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function lastCodexErrors(jsonl: string): string {
  const messages: string[] = [];
  for (const line of jsonl.split("\n")) {
    try {
      const event = JSON.parse(line) as { type?: string; message?: string; error?: { message?: string } };
      if (event.type === "error" && event.message) {
        messages.push(event.message);
      } else if (event.type === "turn.failed" && event.error?.message) {
        messages.push(event.error.message);
      }
    } catch {
      // not JSON
    }
  }
  return messages.slice(-3).join("\n");
}

function capResponse(text: string): string {
  return text.length <= MAX_RESPONSE_CHARS
    ? text
    : text.slice(0, MAX_RESPONSE_CHARS) + `\n\n[response truncated at ${MAX_RESPONSE_CHARS} characters]`;
}

/** Runs crosscheck children one at a time and lets the lead wait, poll, and cancel. */
export class CallManager {
  private readonly calls = new Map<string, Call>();
  private active: Call | undefined;

  constructor(private readonly context: Context) {}

  running(): Call | undefined {
    return this.active?.status === "running" ? this.active : undefined;
  }

  async start(agent: string, prompt: string): Promise<ToolText> {
    if (agent !== CROSSCHECK_AGENT) {
      return errorText("invalid_target", `agent must be "${CROSSCHECK_AGENT}", the only target this plugin supports.`);
    }
    if (prompt.trim() === "") {
      return errorText("invalid_request", "prompt is required.");
    }
    const busy = this.running();
    if (busy) {
      return errorText(
        "call_in_progress",
        `Call ${busy.id} is still running. Poll it with get_agent_call or stop it with cancel_agent_call before starting another.`,
        { call_id: busy.id },
      );
    }

    let root: string;
    try {
      root = await repoRoot(this.context);
    } catch (error) {
      return errorText("call_agent_unavailable", (error as Error).message);
    }
    const owner = inProgressChanges(root)
      .map((name) => readState(root, name))
      .find((state) => state?.current_step !== null && state !== undefined && CALL_STEPS.includes(state.current_step));
    if (!owner || owner.current_step === null) {
      return errorText(
        "call_agent_unavailable",
        "call_agent is only available during the proposal and approach-review steps of a define that is in progress.",
      );
    }

    const lead = detectLead(this.context.clientName(), this.context.env);
    const choice = chooseCrosscheck(lead, this.context.env);
    if (typeof choice === "string") {
      return errorText("invalid_cli", choice);
    }

    const id = `call-${randomBytes(4).toString("hex")}`;
    const dir = join(repoLogDir(this.context, root), id);
    mkdirSync(dir, { recursive: true });
    const lastMessageFile = join(dir, "last-message.txt");
    const command = childCommand({ ...choice, prompt, pluginRoot: this.context.pluginRoot, lastMessageFile });
    writeFileSync(join(dir, "prompt.txt"), prompt);
    writeFileSync(join(dir, "command.json"), JSON.stringify({ command: command.command, args: command.args.slice(0, -1) }, null, 2));

    let resolveDone: () => void = () => {};
    const call: Call = {
      id,
      cli: choice.cli,
      effort: choice.effort,
      root,
      changeName: owner.change_name,
      step: owner.current_step,
      dir,
      startedAt: this.context.now(),
      status: "running",
      done: new Promise<void>((resolve) => (resolveDone = resolve)),
      cancelRequested: false,
      ...(choice.model === undefined ? {} : { model: choice.model }),
    };
    call.fingerprintBefore = await workingTreeFingerprint(root, this.context.env);
    this.calls.set(id, call);
    this.active = call;

    const stdoutFd = openSync(join(dir, "stdout"), "w");
    const stderrFd = openSync(join(dir, "stderr"), "w");
    let child: ChildProcess;
    try {
      child = spawn(command.command, command.args, {
        cwd: root,
        env: childEnv(this.context.env),
        stdio: ["ignore", stdoutFd, stderrFd],
        detached: true,
      });
    } catch (error) {
      closeSync(stdoutFd);
      closeSync(stderrFd);
      await this.settle(call, null, null, `could not start ${command.command}: ${(error as Error).message}`);
      resolveDone();
      return this.snapshot(call);
    }
    call.child = child;
    logEvent(this.context, root, "call_start", {
      call_id: id,
      cli: call.cli,
      model: call.model,
      effort: call.effort,
      step: call.step,
      child_pid: child.pid,
    });

    let finished = false;
    const finish = (code: number | null, signal: NodeJS.Signals | null, launchError?: string) => {
      if (finished) {
        return;
      }
      finished = true;
      closeSync(stdoutFd);
      closeSync(stderrFd);
      void this.settle(call, code, signal, launchError).finally(resolveDone);
    };
    child.on("error", (error) => {
      if (child.pid === undefined) {
        finish(null, null, `could not start ${command.command}: ${error.message}`);
      }
    });
    child.on("close", (code, signal) => finish(code, signal));
    return this.wait(call);
  }

  async get(callId: string): Promise<ToolText> {
    const call = this.calls.get(callId.trim());
    if (!call) {
      return errorText("unknown_call", `No call with call_id ${JSON.stringify(callId)} was started by this server.`);
    }
    return this.wait(call);
  }

  async cancel(callId: string): Promise<ToolText> {
    const call = this.calls.get(callId.trim());
    if (!call) {
      return errorText("unknown_call", `No call with call_id ${JSON.stringify(callId)} was started by this server.`);
    }
    if (call.status !== "running") {
      return this.snapshot(call);
    }
    call.cancelRequested = true;
    this.signal(call, "SIGTERM");
    const timer = setTimeout(() => this.signal(call, "SIGKILL"), KILL_GRACE_MS);
    timer.unref();
    await Promise.race([call.done, new Promise((resolve) => setTimeout(resolve, Math.min(this.context.waitMs, 15_000)))]);
    return this.snapshot(call);
  }

  /** Stops every running child. Called when the server exits, so no child outlives its lead. */
  killAll(): void {
    for (const call of this.calls.values()) {
      if (call.status === "running") {
        call.cancelRequested = true;
        this.signal(call, "SIGTERM");
      }
    }
  }

  private signal(call: Call, signal: NodeJS.Signals): void {
    const pid = call.child?.pid;
    if (pid === undefined) {
      return;
    }
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        call.child?.kill(signal);
      } catch {
        // already gone
      }
    }
  }

  private async wait(call: Call): Promise<ToolText> {
    if (call.status === "running") {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([call.done, new Promise((resolve) => (timer = setTimeout(resolve, this.context.waitMs)))]);
      clearTimeout(timer);
    }
    return this.snapshot(call);
  }

  private snapshot(call: Call): ToolText {
    const now = call.endedAt ?? this.context.now();
    const base: Record<string, unknown> = {
      status: call.status,
      call_id: call.id,
      cli: call.cli,
      model: call.model ?? "default",
      effort: call.effort,
      elapsed: formatElapsed(now.getTime() - call.startedAt.getTime()),
    };
    if (call.status === "running") {
      base.next = "Call get_agent_call with this call_id to keep waiting. This is not the child's answer.";
      return { text: JSON.stringify(base, null, 2) };
    }
    base.working_tree = call.workingTree ?? "unknown";
    if (call.costUsd !== undefined) {
      base.cost_usd = call.costUsd;
    }
    if (call.error) {
      base.error = call.error;
    }
    if (call.response !== undefined) {
      base.response = call.response;
    }
    return { text: JSON.stringify(base, null, 2), isError: call.status === "failed" };
  }

  private async settle(call: Call, code: number | null, signal: NodeJS.Signals | null, launchError?: string): Promise<void> {
    const stdout = readText(join(call.dir, "stdout"));
    const stderr = readText(join(call.dir, "stderr"));
    const exit = signal ? `signal ${signal}` : `exit code ${code}`;

    if (call.cancelRequested) {
      call.status = "canceled";
      call.error = { code: "call_canceled", message: `The call was canceled (${exit}).` };
    } else if (launchError) {
      call.status = "failed";
      call.error = { code: "launch_failed", message: launchError };
    } else if (call.cli === "codex") {
      const last = readText(join(call.dir, "last-message.txt")).trim();
      if (code === 0 && last !== "") {
        call.status = "succeeded";
        call.response = capResponse(last);
      } else {
        call.status = "failed";
        const detail = [lastCodexErrors(stdout), tail(stderr, 1500)].filter(Boolean).join("\n");
        call.error = { code: "execution_failed", message: `codex ended with ${exit} and no final message. ${detail}`.trim() };
      }
    } else {
      let parsed: { result?: unknown; is_error?: boolean; total_cost_usd?: number; subtype?: string } | undefined;
      try {
        parsed = JSON.parse(stdout.trim()) as typeof parsed;
      } catch {
        parsed = undefined;
      }
      if (typeof parsed?.total_cost_usd === "number") {
        call.costUsd = parsed.total_cost_usd;
      }
      if (code === 0 && parsed && parsed.is_error !== true && typeof parsed.result === "string" && parsed.result.trim() !== "") {
        call.status = "succeeded";
        call.response = capResponse(parsed.result.trim());
      } else {
        call.status = "failed";
        const reported = typeof parsed?.result === "string" ? parsed.result : parsed?.subtype ?? "";
        call.error = {
          code: "execution_failed",
          message: `claude ended with ${exit}. ${[reported, tail(stderr, 1500)].filter(Boolean).join("\n")}`.trim(),
        };
      }
    }

    call.endedAt = this.context.now();
    const after = await workingTreeFingerprint(call.root, this.context.env);
    call.workingTree =
      call.fingerprintBefore === undefined || after === undefined
        ? "unknown"
        : call.fingerprintBefore === after
          ? "unchanged"
          : "changed";
    logEvent(this.context, call.root, "call_end", {
      call_id: call.id,
      status: call.status,
      exit,
      working_tree: call.workingTree,
      cost_usd: call.costUsd,
    });
    this.record(call);
  }

  /** Adds the finished call to the change's state file, after the working-tree check. */
  private record(call: Call): void {
    try {
      const state = readState(call.root, call.changeName);
      if (!state || !existsSync(call.root)) {
        return;
      }
      state.calls.push({
        call_id: call.id,
        step: call.step,
        cli: call.cli,
        ...(call.model === undefined ? {} : { model: call.model }),
        effort: call.effort,
        status: call.status,
        ...(call.workingTree === undefined ? {} : { working_tree: call.workingTree }),
        started_at: call.startedAt.toISOString(),
        ended_at: (call.endedAt ?? this.context.now()).toISOString(),
      });
      writeState(call.root, state, this.context.now().toISOString());
    } catch {
      // The call result still reaches the lead.
    }
  }
}
