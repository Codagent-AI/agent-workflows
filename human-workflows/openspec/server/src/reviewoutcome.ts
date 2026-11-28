import { createReadStream, readFileSync } from "node:fs";
import { join } from "node:path";

import { tail } from "./proc.js";

const MAX_ANSWER = 200_000;

interface Event {
  id?: string | number;
  method?: string;
  params?: { update?: { sessionUpdate?: string; content?: { type?: string; text?: string } } };
  result?: { stopReason?: string };
  error?: { data?: { details?: unknown }; message?: string };
}

interface ReviewOutput {
  answer: string;
  stop?: string;
  error: string;
}

function parseEvent(line: string): Event | undefined {
  try {
    return JSON.parse(line) ?? undefined;
  } catch {
    return undefined;
  }
}

function errorDetail(error: NonNullable<Event["error"]>): string {
  const detail = error.data?.details ?? error.message;
  return typeof detail === "string" ? detail : JSON.stringify(detail) ?? "";
}

class ReviewEvents {
  current = "";
  previous = "";
  promptId: Event["id"];
  matched: string | undefined;
  fallback: string | undefined;
  error = "";

  add(event: Event): void {
    if (event.method === "session/update") {
      this.addUpdate(event.params?.update);
    }
    if (event.method === "session/prompt") {
      this.promptId = event.id;
    }
    const stop = event.result?.stopReason;
    if (typeof stop === "string") {
      this.fallback = stop;
      if (this.promptId !== undefined && event.id === this.promptId) {
        this.matched = stop;
      }
    }
    if (event.error) {
      this.error = errorDetail(event.error);
    }
  }

  private addUpdate(update: NonNullable<Event["params"]>["update"]): void {
    if (update?.sessionUpdate === "tool_call") {
      this.previous = this.current.trim() || this.previous;
      this.current = "";
    }
    if (update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text" && typeof update.content.text === "string") {
      this.current += update.content.text;
    }
  }

  output(stderr: string): ReviewOutput {
    const stop = this.matched ?? this.fallback;
    return {
      answer: this.current.trim() || this.previous,
      ...(stop === undefined ? {} : { stop }),
      error: [this.error, stderr].filter(Boolean).join("\n"),
    };
  }
}

async function* eventLines(path: string): AsyncGenerator<string> {
  let pieces: string[] = [];
  for await (const chunk of createReadStream(path, { encoding: "utf8" })) {
    const [first = "", ...lines] = (chunk as string).split("\n");
    pieces.push(first);
    if (lines.length > 0) {
      yield pieces.join("");
      const tailPiece = lines.pop() ?? "";
      yield* lines;
      pieces = [tailPiece];
    }
  }
  const last = pieces.join("");
  if (last) {
    yield last;
  }
}

export async function readReview(dir: string): Promise<ReviewOutput> {
  const events = new ReviewEvents();
  for await (const line of eventLines(join(dir, "events.ndjson"))) {
    const event = parseEvent(line);
    if (event) {
      events.add(event);
    }
  }
  return events.output(tail(readFileSync(join(dir, "stderr.txt"), "utf8")));
}

export interface Exit {
  code: number | null;
  signal?: NodeJS.Signals | null;
  launchError?: string;
  stopped?: "timeout" | "canceled";
}

export type Outcome =
  | { status: "canceled" }
  | { status: "succeeded"; response: string }
  | { status: "failed"; code: string; error: string };

function failed(code: string, message: string, detail?: string): Outcome {
  return { status: "failed", code, error: detail ? `${message}\n${detail}` : message };
}

export function reviewOutcome(exit: Exit, review?: ReviewOutput): Outcome {
  if (exit.stopped === "timeout") {
    return failed("timeout", "Crosscheck reached its time limit.");
  }
  if (exit.stopped === "canceled") {
    return { status: "canceled" };
  }
  if (exit.launchError) {
    return failed("launch_failed", exit.launchError);
  }
  if (exit.code === 3) {
    return failed("timeout", "acpx timed out (exit 3).", review?.error);
  }
  if (exit.code !== 0) {
    return failed("execution_failed", `acpx exited with ${exit.signal ?? exit.code}.`, review?.error);
  }
  if (!review?.stop) {
    return failed("execution_failed", "acpx returned no stop reason.", review?.error);
  }
  if (review.stop !== "end_turn") {
    return failed("stopped", `Reviewer stopped with ${review.stop}.`, review.error);
  }
  if (!review.answer) {
    return failed("empty_answer", "Reviewer returned an empty answer.", review.error);
  }
  const response = review.answer.length > MAX_ANSWER ? `${review.answer.slice(0, MAX_ANSWER)}\n[Answer truncated at 200,000 characters.]` : review.answer;
  return { status: "succeeded", response };
}
