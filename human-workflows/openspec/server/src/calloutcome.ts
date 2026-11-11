import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Call } from "./call.js";
import { tail } from "./proc.js";

const MAX_RESPONSE_CHARS = 200_000;

/** How a child ended. `launchError` is set when it never started. */
export interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
  launchError?: string | undefined;
}

export function describeExit(exit: Exit): string {
  return exit.signal ? `signal ${exit.signal}` : `exit code ${exit.code}`;
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
    : `${text.slice(0, MAX_RESPONSE_CHARS)}\n\n[response truncated at ${MAX_RESPONSE_CHARS} characters]`;
}

function succeed(call: Call, response: string): void {
  call.status = "succeeded";
  call.response = capResponse(response);
}

function fail(call: Call, code: string, message: string): void {
  call.status = "failed";
  call.error = { code, message };
}

/** Codex writes its final message to a file; a clean exit with that file filled in is success. */
function codexOutcome(call: Call, exit: Exit): void {
  const last = readText(join(call.dir, "last-message.txt")).trim();
  if (exit.code === 0 && last !== "") {
    succeed(call, last);
    return;
  }
  const detail = [lastCodexErrors(readText(join(call.dir, "stdout"))), tail(readText(join(call.dir, "stderr")), 1500)]
    .filter(Boolean)
    .join("\n");
  fail(call, "execution_failed", `codex ended with ${describeExit(exit)} and no final message. ${detail}`.trim());
}

interface ClaudeResult {
  result?: unknown;
  is_error?: boolean;
  total_cost_usd?: number;
  subtype?: string;
}

function parseClaudeResult(stdout: string): ClaudeResult | undefined {
  try {
    return JSON.parse(stdout.trim()) as ClaudeResult | undefined;
  } catch {
    return undefined;
  }
}

/** The answer in claude's JSON result, when the run succeeded and produced one. */
function claudeAnswer(parsed: ClaudeResult | undefined, code: number | null): string | undefined {
  if (code === 0 && parsed && parsed.is_error !== true && typeof parsed.result === "string" && parsed.result.trim() !== "") {
    return parsed.result.trim();
  }
  return undefined;
}

/** Claude prints one JSON result on stdout, with the cost, the answer, and an error flag. */
function claudeOutcome(call: Call, exit: Exit): void {
  const parsed = parseClaudeResult(readText(join(call.dir, "stdout")));
  if (typeof parsed?.total_cost_usd === "number") {
    call.costUsd = parsed.total_cost_usd;
  }
  const answer = claudeAnswer(parsed, exit.code);
  if (answer !== undefined) {
    succeed(call, answer);
    return;
  }
  const reported = typeof parsed?.result === "string" ? parsed.result : (parsed?.subtype ?? "");
  const stderr = tail(readText(join(call.dir, "stderr")), 1500);
  fail(call, "execution_failed", `claude ended with ${describeExit(exit)}. ${[reported, stderr].filter(Boolean).join("\n")}`.trim());
}

/** Sets the call's status, response, cost, and error from how its child ended and what it wrote. */
export function applyOutcome(call: Call, exit: Exit): void {
  if (call.cancelRequested) {
    call.status = "canceled";
    call.error = { code: "call_canceled", message: `The call was canceled (${describeExit(exit)}).` };
  } else if (exit.launchError) {
    fail(call, "launch_failed", exit.launchError);
  } else if (call.cli === "codex") {
    codexOutcome(call, exit);
  } else {
    claudeOutcome(call, exit);
  }
}
