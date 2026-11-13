import { fileURLToPath } from "node:url";

/** Experimental capability that asks Codex to include `codex/sandbox-state-meta` in tools/call `_meta`. */
export const CODEX_SANDBOX_META_CAPABILITY = "codex/sandbox-state-meta";

/**
 * The lead session's working directory from a tool call's `_meta`, when the client sends it.
 *
 * Codex starts plugin MCP servers in the plugin folder (`cwd: "."` in `.codex-mcp.json`), so the
 * server's own directory says nothing about the session. A server that declares the
 * `codex/sandbox-state-meta` capability gets the session's directory as `sandboxCwd` in the `_meta`
 * of every tools/call. Claude Code sends none of this and this returns undefined: the server reads
 * `CLAUDE_PROJECT_DIR` there instead (see main.ts).
 */
export function sessionCwdFromMeta(meta: unknown): string | undefined {
  if (!meta || typeof meta !== "object") {
    return undefined;
  }
  const state = (meta as Record<string, unknown>)[CODEX_SANDBOX_META_CAPABILITY] as { sandboxCwd?: unknown } | undefined;
  const cwd = state?.sandboxCwd;
  if (typeof cwd !== "string" || cwd === "") {
    return undefined;
  }
  try {
    return cwd.startsWith("file:") ? fileURLToPath(cwd) : cwd;
  } catch {
    return undefined;
  }
}
