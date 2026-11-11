import { type Call, errorText, snapshotOf } from "./call.js";
import { type CallOwner, chooseCallOwner } from "./callowner.js";
import { recordCall } from "./callrecord.js";
import { applyOutcome, describeExit, type Exit } from "./calloutcome.js";
import { type LoggedChild, prepareChild, spawnLogged } from "./callchild.js";
import { type ChildCommand, type CrosscheckChoice, detectLead } from "./child.js";
import { resolveCrosscheck } from "./config.js";
import { type Context, logEvent, repoRoot } from "./context.js";
import type { ToolText } from "./finish.js";
import { compareFingerprints, workingTreeFingerprint } from "./worktree.js";

export const CROSSCHECK_AGENT = "crosscheck";
const KILL_GRACE_MS = 10_000;
/** The longest a crosscheck call may run: 60 minutes. */
export const MAX_CALL_MS = 60 * 60 * 1000;
const SHUTDOWN_GRACE_MS = 3_000;

/** Everything a start needs once its checks pass. */
interface StartPlan {
  root: string;
  owner: CallOwner;
  choice: CrosscheckChoice;
}

/** Runs crosscheck children one at a time and lets the lead wait, poll, and cancel. */
export class CallManager {
  private readonly calls = new Map<string, Call>();
  private active: Call | undefined;
  /** True from the busy check until a new call is the active one. */
  private starting = false;

  constructor(private readonly context: Context) {}

  running(): Call | undefined {
    return this.active?.status === "running" ? this.active : undefined;
  }

  async start(agent: string, prompt: string, cwd: string = this.context.cwd, changeName?: string): Promise<ToolText> {
    const refusal = this.startRefusal(agent, prompt);
    if (refusal) {
      return refusal;
    }
    // Hold the slot before the first await, so overlapping starts cannot both pass the busy check.
    this.starting = true;
    let call: Call;
    let command: ChildCommand;
    try {
      const plan = await this.planStart(cwd, changeName);
      if ("text" in plan) {
        return plan;
      }
      const prepared = prepareChild(this.context, plan.root, prompt, plan.choice);
      command = prepared.command;
      call = await this.register(plan, prepared.id, prepared.dir);
    } finally {
      this.starting = false;
    }
    return this.launch(call, command);
  }

  async get(callId: string): Promise<ToolText> {
    const call = this.calls.get(callId.trim());
    return call ? this.wait(call) : unknownCall(callId);
  }

  async cancel(callId: string): Promise<ToolText> {
    const call = this.calls.get(callId.trim());
    if (!call) {
      return unknownCall(callId);
    }
    if (call.status !== "running") {
      return this.snapshot(call);
    }
    this.terminate(call);
    await Promise.race([call.done, new Promise((resolve) => setTimeout(resolve, Math.min(this.context.waitMs, 15_000)))]);
    return this.snapshot(call);
  }

  /**
   * Stops every running child. Called when the server exits, so no child outlives its lead. A child
   * that is still running after `graceMs` is killed.
   */
  async killAll(graceMs: number = SHUTDOWN_GRACE_MS): Promise<void> {
    const running = [...this.calls.values()].filter((call) => call.status === "running");
    for (const call of running) {
      this.terminate(call);
    }
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.all(running.map((call) => call.done)),
      new Promise((resolve) => (timer = setTimeout(resolve, graceMs))),
    ]);
    clearTimeout(timer);
    for (const call of running) {
      if (call.status === "running") {
        this.signal(call, "SIGKILL");
      }
    }
  }

  /** Asks the child to stop, and kills it if it is still there after the grace period. Safe to repeat. */
  private terminate(call: Call): void {
    call.cancelRequested = true;
    this.signal(call, "SIGTERM");
    if (call.killTimer === undefined) {
      call.killTimer = setTimeout(() => this.signal(call, "SIGKILL"), KILL_GRACE_MS);
      call.killTimer.unref();
    }
  }

  /** The refusal for a bad request or a call already running, if any. */
  private startRefusal(agent: string, prompt: string): ToolText | undefined {
    if (agent !== CROSSCHECK_AGENT) {
      return errorText("invalid_target", `agent must be "${CROSSCHECK_AGENT}", the only target this plugin supports.`);
    }
    if (prompt.trim() === "") {
      return errorText("invalid_request", "prompt is required.");
    }
    if (this.starting) {
      return errorText("call_in_progress", "Another call_agent is still starting. Try again in a moment.");
    }
    const busy = this.running();
    if (busy) {
      return errorText(
        "call_in_progress",
        `Call ${busy.id} is still running. Poll it with get_agent_call or stop it with cancel_agent_call before starting another.`,
        { call_id: busy.id },
      );
    }
    return undefined;
  }

  /** Finds the repository, the define the call belongs to, and the crosscheck to run, or says why it cannot. */
  private async planStart(cwd: string, changeName: string | undefined): Promise<StartPlan | ToolText> {
    let root: string;
    try {
      root = await repoRoot({ ...this.context, cwd });
    } catch (error) {
      return errorText("call_agent_unavailable", (error as Error).message);
    }
    const owner = chooseCallOwner(this.context.workflow, root, changeName);
    if ("text" in owner) {
      return owner;
    }
    const choice = resolveCrosscheck(detectLead(this.context.clientName(), this.context.env), this.context.env);
    if (typeof choice === "string") {
      return errorText("crosscheck_not_configured", choice);
    }
    return { root, owner, choice };
  }

  /** Creates the call, takes the working-tree fingerprint, and makes it the active call. */
  private async register(plan: StartPlan, id: string, dir: string): Promise<Call> {
    const { root, owner, choice } = plan;
    let markDone: () => void = () => {};
    const call: Call = {
      id,
      cli: choice.cli,
      effort: choice.effort,
      root,
      changeName: owner.changeName,
      step: owner.step,
      dir,
      startedAt: this.context.now(),
      status: "running",
      done: new Promise<void>((resolve) => {
        markDone = resolve;
      }),
      markDone: () => markDone(),
      cancelRequested: false,
      limitMs: this.context.maxCallMs ?? MAX_CALL_MS,
      timedOut: false,
      ...(choice.model === undefined ? {} : { model: choice.model }),
    };
    call.fingerprintBefore = await workingTreeFingerprint(root, this.context.env);
    this.calls.set(id, call);
    this.active = call;
    return call;
  }

  /** Starts the child, then waits for it up to the poll window. */
  private async launch(call: Call, command: ChildCommand): Promise<ToolText> {
    let logged: LoggedChild;
    try {
      logged = spawnLogged(command, call.dir, call.root, this.context.env);
    } catch (error) {
      await this.settle(call, { code: null, signal: null, launchError: launchErrorText(command, (error as Error).message) });
      call.markDone();
      return this.snapshot(call);
    }
    call.child = logged.child;
    logEvent(this.context, call.root, "call_start", {
      call_id: call.id,
      cli: call.cli,
      model: call.model,
      effort: call.effort,
      step: call.step,
      child_pid: logged.child.pid,
    });
    this.watch(call, logged, command);
    call.limitTimer = setTimeout(() => {
      call.timedOut = true;
      this.terminate(call);
    }, call.limitMs);
    call.limitTimer.unref();
    return this.wait(call);
  }

  /** Settles the call once, when its child closes or fails to start. */
  private watch(call: Call, logged: LoggedChild, command: ChildCommand): void {
    const { child, closeLogs } = logged;
    let finished = false;
    const finish = (exit: Exit) => {
      if (finished) {
        return;
      }
      finished = true;
      closeLogs();
      // The leader is gone. Clear the timer so a reused group id is never signaled, and sweep any
      // group members a cancel left behind.
      clearTimeout(call.killTimer);
      clearTimeout(call.limitTimer);
      if (call.cancelRequested) {
        this.signal(call, "SIGKILL");
      }
      void this.settle(call, exit).finally(call.markDone);
    };
    child.on("error", (error) => {
      if (child.pid === undefined) {
        finish({ code: null, signal: null, launchError: launchErrorText(command, error.message) });
      }
    });
    child.on("close", (code, signal) => finish({ code, signal }));
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
    return snapshotOf(call, this.context.now());
  }

  /** Reads the child's result, checks whether the working tree changed, logs the end, and records the call. */
  private async settle(call: Call, exit: Exit): Promise<void> {
    const endedAt = this.context.now();
    // The call stays running until its working-tree check is done, so next_step and get_agent_call
    // never see a finished call with an unknown result.
    const after = await workingTreeFingerprint(call.root, this.context.env);
    applyOutcome(call, exit);
    call.endedAt = endedAt;
    call.workingTree = compareFingerprints(call.fingerprintBefore, after);
    logEvent(this.context, call.root, "call_end", {
      call_id: call.id,
      status: call.status,
      exit: describeExit(exit),
      working_tree: call.workingTree,
      cost_usd: call.costUsd,
    });
    recordCall(this.context, call);
  }
}

function unknownCall(callId: string): ToolText {
  return errorText("unknown_call", `No call with call_id ${JSON.stringify(callId)} was started by this server.`);
}

function launchErrorText(command: ChildCommand, message: string): string {
  return `could not start ${command.command}: ${message}`;
}
