import { effortApplied } from "./acpx.js";
import type { ToolText } from "./finish.js";
import type { Reviewer } from "./reviewer.js";
import type { TreeResult } from "./worktree.js";

export type Status = "running" | "succeeded" | "failed" | "canceled";

export interface Crosscheck {
  id: string;
  startedAt: Date;
  endedAt?: Date;
  status: Status;
  reviewers: Reviewer[];
  tree?: TreeResult;
  done: Promise<void>;
  canceled: boolean;
}

export function errorText(code: string, message: string, extra: Record<string, unknown> = {}): ToolText {
  return { text: JSON.stringify({ error: { code, message }, ...extra }, null, 2), isError: true };
}

function formatElapsed(start: Date, end: Date): string {
  const seconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

type ReviewerDetails = Pick<Reviewer, "entry" | "outcome" | "startedAt" | "endedAt">;
type BatchDetails = Omit<Crosscheck, "reviewers" | "done" | "canceled"> & { reviewers: readonly ReviewerDetails[] };

function reviewerResult(reviewer: ReviewerDetails, now: Date, running: boolean) {
  const { cli, model, effort } = reviewer.entry;
  const outcome = reviewer.outcome;
  return {
    cli,
    model: model ?? "default",
    effort: effortApplied(cli) ? effort : `not applied (${effort})`,
    elapsed: formatElapsed(reviewer.startedAt, reviewer.endedAt ?? now),
    ...(running ? { status: outcome?.status ?? "running" } : outcome),
  };
}

export function snapshotOf(call: BatchDetails, now: Date): ToolText {
  const running = call.status === "running";
  const result = {
    status: call.status,
    crosscheck_id: call.id,
    elapsed: formatElapsed(call.startedAt, call.endedAt ?? now),
    reviewers: call.reviewers.map((reviewer) => reviewerResult(reviewer, now, running)),
    ...(running ? { next: "Call get_crosscheck with this crosscheck_id to keep waiting. This is not the answer." } : call.tree),
  };
  const isError = !running && call.reviewers.every((reviewer) => reviewer.outcome?.status !== "succeeded");
  return { text: JSON.stringify(result, null, 2), isError };
}
