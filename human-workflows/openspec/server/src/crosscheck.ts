import { join } from "node:path";

import { detectLead, effortApplied } from "./acpx.js";
import { AcpxVersion } from "./acpx-version.js";
import { type Crosscheck, errorText, snapshotOf } from "./call.js";
import { newCrosscheckId, reserveLogDir } from "./callchild.js";
import { isValidChangeName } from "./checks.js";
import { type CrosscheckChoice, resolveCrosscheck } from "./config.js";
import { type Context, logEvent, RepoError, repoRoot } from "./context.js";
import type { ToolText } from "./finish.js";
import { Gate } from "./gate.js";
import { Reviewer } from "./reviewer.js";
import { readState, StateError, writeState } from "./state.js";
import type { StepId } from "./steps.js";
import { compareTrees, snapshotTree, type TreeSnapshot } from "./worktree.js";

export const MAX_CALL_MS = 60 * 60 * 1000;
const SHUTDOWN_GRACE_MS = 3_000;

interface Owner {
  name: string;
  step: StepId;
}

interface StartPlan {
  root: string;
  entries: CrosscheckChoice[];
  owner?: Owner | undefined;
}

function findOwner(context: Context, root: string, name: string): Owner | undefined {
  if (isValidChangeName(name)) {
    const state = readState(context.workflow, root, name);
    if (state?.status === "in_progress" && state.current_step !== null) {
      return { name, step: state.current_step };
    }
  }
  return undefined;
}

function record(context: Context, plan: StartPlan, call: Crosscheck): void {
  if (!(plan.owner && call.endedAt && call.tree)) {
    return;
  }
  const { name, step } = plan.owner;
  try {
    const state = readState(context.workflow, plan.root, name);
    if (!state) {
      throw new StateError(`Define "${name}" no longer has a state file.`);
    }
    state.crosschecks.push({
      crosscheck_id: call.id,
      step,
      status: call.status,
      working_tree: call.tree.working_tree,
      started_at: call.startedAt.toISOString(),
      ended_at: call.endedAt.toISOString(),
      reviewers: call.reviewers.map(({ entry, outcome }) => ({
        ...entry,
        effort_applied: effortApplied(entry.cli),
        status: outcome?.status ?? "failed",
        ...(outcome?.status === "failed" ? { code: outcome.code } : {}),
      })),
    });
    writeState(plan.root, state, context.now().toISOString());
  } catch (error) {
    logEvent(context, plan.root, "crosscheck_record_failed", { crosscheck_id: call.id, error: String(error) });
  }
}

export class CrosscheckManager {
  private readonly calls = new Map<string, Crosscheck>();
  private active?: Crosscheck;
  private startingId: string | undefined;
  private shuttingDown = false;
  readonly stepGate = new Gate();
  readonly acpx = new AcpxVersion();

  constructor(private readonly context: Context) {}

  busyId(): string | undefined {
    return this.startingId ?? this.running()?.id;
  }

  private running(): Crosscheck | undefined {
    return this.active?.status === "running" ? this.active : undefined;
  }

  private startRefusal(prompt: string): ToolText | undefined {
    if (prompt.trim() === "") {
      return errorText("invalid_request", "prompt is required.");
    }
    const busy = this.busyId();
    if (busy) {
      return errorText("crosscheck_in_progress", `Crosscheck ${busy} is starting or running.`, { crosscheck_id: busy });
    }
    if (this.stepGate.held) {
      return errorText("step_in_progress", "next_step is still running. Call crosscheck again after it returns.");
    }
    return this.shuttingDown ? errorText("server_shutting_down", "The server is shutting down.") : undefined;
  }

  async start(prompt: string, cwd: string | null = this.context.cwd, changeName?: string): Promise<ToolText> {
    const refusal = this.startRefusal(prompt);
    if (refusal) {
      return refusal;
    }
    this.startingId = newCrosscheckId();
    try {
      const plan = await this.planStart(cwd, changeName);
      if ("text" in plan) {
        return plan;
      }
      const reserved = reserveLogDir(this.context, plan.root, this.startingId);
      this.startingId = reserved.id;
      const before = await snapshotTree({ cwd: plan.root, env: this.context.env });
      if (this.shuttingDown) {
        return errorText("server_shutting_down", "The server is shutting down.");
      }
      return this.wait(this.launch(plan, reserved, prompt, before));
    } finally {
      this.startingId = undefined;
    }
  }

  private async planStart(cwd: string | null, changeName?: string): Promise<StartPlan | ToolText> {
    const unavailable = await this.acpx.refusal(cwd ?? this.context.cwd, this.context.env);
    if (unavailable) {
      return errorText("crosscheck_not_configured", unavailable);
    }
    const entries = resolveCrosscheck(detectLead(this.context.clientName(), this.context.env), this.context.env);
    if (typeof entries === "string") {
      return errorText("crosscheck_not_configured", entries);
    }
    if (cwd === null) {
      return errorText("session_folder_unavailable", "Crosscheck needs the session's working folder.");
    }
    return this.resolveFolder(cwd, entries, changeName);
  }

  private async resolveFolder(cwd: string, entries: CrosscheckChoice[], changeName?: string): Promise<StartPlan | ToolText> {
    try {
      const root = await repoRoot({ ...this.context, cwd });
      if (changeName === undefined) {
        return { root, entries };
      }
      const owner = findOwner(this.context, root, changeName.trim());
      if (owner) {
        return { root, entries, owner };
      }
    } catch (error) {
      if (!(error instanceof RepoError || error instanceof StateError)) {
        throw error;
      }
      if (changeName === undefined) {
        return { root: cwd, entries };
      }
      return errorText("define_not_in_progress", error.message);
    }
    return errorText("define_not_in_progress", `No define in progress named ${JSON.stringify(changeName)}.`);
  }

  private launch(
    plan: StartPlan,
    { id, dir }: { id: string; dir: string },
    prompt: string,
    before: TreeSnapshot | undefined,
  ): Crosscheck {
    const startedAt = this.context.now();
    const reviewers = plan.entries.map((entry, index) =>
      new Reviewer(entry, join(dir, `${index + 1}-${entry.cli}`), this.context, { root: plan.root, prompt }),
    );
    const call: Crosscheck = { id, startedAt, status: "running", canceled: false, reviewers, done: Promise.resolve() };
    this.active = call;
    this.calls.set(id, call);
    logEvent(this.context, plan.root, "crosscheck_start", { crosscheck_id: id, change_name: plan.owner?.name });
    const limit = setTimeout(() => {
      for (const reviewer of reviewers) {
        reviewer.stop("timeout");
      }
    }, this.context.maxCallMs ?? MAX_CALL_MS);
    call.done = Promise.all(reviewers.map((reviewer) => reviewer.done)).then(() => {
      clearTimeout(limit);
      return this.settle(plan, call, before);
    });
    return call;
  }

  private async settle(plan: StartPlan, call: Crosscheck, before: TreeSnapshot | undefined): Promise<void> {
    call.endedAt = this.context.now();
    const options = { cwd: plan.root, env: this.context.env };
    call.tree = await compareTrees(before, await snapshotTree(options), options);
    call.status = call.reviewers.every((reviewer) => reviewer.outcome?.status === "succeeded") ? "succeeded" : "failed";
    if (call.canceled) {
      call.status = "canceled";
    }
    record(this.context, plan, call);
    logEvent(this.context, plan.root, "crosscheck_end", { crosscheck_id: call.id, status: call.status, working_tree: call.tree.working_tree });
  }

  async get(id: string): Promise<ToolText> {
    const call = this.calls.get(id.trim());
    return call ? this.wait(call) : unknown(id);
  }

  async cancel(id: string): Promise<ToolText> {
    const call = this.calls.get(id.trim());
    if (!call) {
      return unknown(id);
    }
    this.stop(call);
    return this.wait(call);
  }

  private stop(call: Crosscheck, grace?: number): void {
    if (call.status === "running") {
      call.canceled = true;
      for (const reviewer of call.reviewers) {
        reviewer.stop("canceled", grace);
      }
    }
  }

  async killAll(grace = SHUTDOWN_GRACE_MS): Promise<void> {
    this.shuttingDown = true;
    const call = this.running();
    if (call) {
      this.stop(call, grace);
      await call.done;
    }
  }

  private async wait(call: Crosscheck): Promise<ToolText> {
    if (call.status === "running") {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([call.done, new Promise((resolve) => (timer = setTimeout(resolve, this.context.waitMs)))]);
      } finally {
        clearTimeout(timer);
      }
    }
    return snapshotOf(call, this.context.now());
  }
}

function unknown(id: string): ToolText {
  return errorText("unknown_crosscheck", `No crosscheck with id ${JSON.stringify(id)} was started by this server.`);
}
