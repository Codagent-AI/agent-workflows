import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { output, run } from "./proc.js";
import type { Workflow } from "./steps.js";

/** Everything the server needs from its surroundings, so tests can supply their own. */
export interface Context {
  /**
   * The session's working directory when a call does not carry its own: CLAUDE_PROJECT_DIR on Claude Code.
   * Codex starts the server in the plugin folder, so there each call's `_meta` gives the directory instead.
   */
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** The installed plugin folder, which holds workflow.yaml and skills/. */
  pluginRoot: string;
  /** The steps, loaded from the plugin folder's workflow.yaml. */
  workflow: Workflow;
  /** How long crosscheck and get_crosscheck wait before returning a running snapshot. */
  waitMs: number;
  /** The longest a crosscheck call may run before it is stopped. Defaults to MAX_CALL_MS. */
  maxCallMs?: number;
  killGraceMs?: number;
  /** Where logs and child output go. Never inside the working tree. */
  logBase: string;
  /** The MCP client's name from initialize, once known. */
  clientName: () => string | undefined;
  now: () => Date;
}

/**
 * Kept under the 60 seconds that Codex allows an MCP tool call by default, so a wait never needs the
 * user to raise a timeout setting. Claude Code's default is longer.
 */
export const DEFAULT_WAIT_SECONDS = 50;

export function waitMsFromEnv(env: NodeJS.ProcessEnv): number {
  const raw = env.DEFINE_OPENSPEC_CHANGE_WAIT_SECONDS;
  const seconds = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : DEFAULT_WAIT_SECONDS * 1000;
}

/**
 * One folder per user: in a temp folder users share, such as Linux's /tmp, a single folder would
 * belong to whoever made it first, and the private-folder check would fail for everyone else.
 */
export function defaultLogBase(): string {
  const uid = process.getuid?.();
  return join(tmpdir(), uid === undefined ? "define-openspec-change" : `define-openspec-change-${uid}`);
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

/** Resolve symlinks in existing ancestors even when the private directory is new. */
function resolvedLogPath(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(path) === path) {
      throw error;
    }
    return join(resolvedLogPath(dirname(path)), basename(path));
  }
}

function contains(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return !isAbsolute(fromRoot) && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`);
}

function logBaseFor(context: Context, root: string): string {
  const repo = realpathSync(root);
  const configured = resolvedLogPath(resolve(context.logBase));
  if (!contains(repo, configured)) {
    return configured;
  }
  const fallback = resolvedLogPath(join("/tmp", basename(defaultLogBase())));
  if (contains(repo, fallback)) {
    throw new Error(`No system temp folder outside the working tree at ${root}.`);
  }
  return fallback;
}

export function repoLogDir(context: Context, root: string): string {
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 12);
  const dir = join(logBaseFor(context, root), hash);
  if (contains(realpathSync(root), resolvedLogPath(dir))) {
    throw new Error(`Repository log directory resolves inside the working tree at ${root}: ${dir}`);
  }
  return dir;
}

/** Makes a folder only its owner can use, and tightens one that already exists. Throws if it cannot. */
export function ensurePrivateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

/** The repository's log folder, or a folder under it, created so that only the current user can read it. */
export function privateLogDir(context: Context, root: string, ...parts: string[]): string {
  const repoDir = repoLogDir(context, root);
  ensurePrivateDir(dirname(repoDir));
  ensurePrivateDir(repoDir);
  const dir = join(repoDir, ...parts);
  ensurePrivateDir(dir);
  return dir;
}

/** Appends one JSON line to the repository's event log. Logging never fails a tool call. */
export function logEvent(context: Context, root: string, event: string, fields: Record<string, unknown> = {}): void {
  try {
    const dir = privateLogDir(context, root);
    const line = JSON.stringify({ at: context.now().toISOString(), event, pid: process.pid, root, ...fields });
    appendFileSync(join(dir, "events.jsonl"), `${line}\n`, { mode: 0o600 });
  } catch {
    // ignore
  }
}
