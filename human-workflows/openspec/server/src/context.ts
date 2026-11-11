import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { output, run } from "./proc.js";

/** Everything the server needs from its surroundings, so tests can supply their own. */
export interface Context {
  /** The session's working directory. Both CLIs start the server there. */
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** The installed plugin folder, which holds steps/ and skills/. */
  pluginRoot: string;
  /** How long call_agent and get_agent_call wait before returning a running snapshot. */
  waitMs: number;
  /** Where logs and child output go. Never inside the working tree. */
  logBase: string;
  /** The MCP client's name from initialize, once known. */
  clientName: () => string | undefined;
  now: () => Date;
}

export const DEFAULT_WAIT_SECONDS = 100;

export function waitMsFromEnv(env: NodeJS.ProcessEnv): number {
  const raw = env.DEFINE_OPENSPEC_CHANGE_WAIT_SECONDS;
  const seconds = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : DEFAULT_WAIT_SECONDS * 1000;
}

export function defaultLogBase(): string {
  return join(tmpdir(), "define-openspec-change");
}

export class RepoError extends Error {}

/** The git top level that contains the session's working directory. */
export async function repoRoot(context: Context): Promise<string> {
  const result = await run("git", ["rev-parse", "--show-toplevel"], { cwd: context.cwd, env: context.env });
  if (result.code !== 0) {
    throw new RepoError(`define-openspec-change must run inside a git repository (${context.cwd}): ${output(result)}`);
  }
  return result.stdout.trim();
}

export function repoLogDir(context: Context, root: string): string {
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 12);
  return join(context.logBase, hash);
}

/** Appends one JSON line to the repository's event log. Logging never fails a tool call. */
export function logEvent(context: Context, root: string, event: string, fields: Record<string, unknown> = {}): void {
  try {
    const dir = repoLogDir(context, root);
    mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ at: context.now().toISOString(), event, pid: process.pid, root, ...fields });
    appendFileSync(join(dir, "events.jsonl"), `${line}\n`);
  } catch {
    // ignore
  }
}
