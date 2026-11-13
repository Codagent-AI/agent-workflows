import type { ChildProcess } from "node:child_process";

import type { Cli } from "./child.js";
import type { ToolText } from "./finish.js";
import type { StepId } from "./steps.js";
import type { WorkingTreeChange } from "./worktree.js";

export type Status = "running" | "succeeded" | "failed" | "canceled";

/** One crosscheck child, from start to its final result. */
export interface Call {
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
  /** Resolves `done`. Called once the call has settled. */
  markDone: () => void;
  cancelRequested: boolean;
  /** Fires the SIGKILL that follows a cancel. */
  killTimer?: NodeJS.Timeout;
  /** Stops the child once the call has run for `limitMs`. */
  limitTimer?: NodeJS.Timeout;
  limitMs: number;
  /** True when the call was stopped for running past its time limit. */
  timedOut: boolean;
  fingerprintBefore?: string;
  workingTree?: WorkingTreeChange;
  response?: string;
  costUsd?: number;
  error?: { code: string; message: string };
}

export function errorText(code: string, message: string, extra: Record<string, unknown> = {}): ToolText {
  return { text: JSON.stringify({ error: { code, message }, ...extra }, null, 2), isError: true };
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;
}

/** The tool result for a call as it stands. `now` times a call that is still running. */
export function snapshotOf(call: Call, now: Date): ToolText {
  const end = call.endedAt ?? now;
  const base: Record<string, unknown> = {
    status: call.status,
    call_id: call.id,
    cli: call.cli,
    model: call.model ?? "default",
    effort: call.effort,
    elapsed: formatElapsed(end.getTime() - call.startedAt.getTime()),
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
