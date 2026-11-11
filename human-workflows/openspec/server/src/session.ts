import { fileURLToPath } from "node:url";

/**
 * The lead session's working directory from a tool call's `_meta`, when the client sends it.
 *
 * Codex starts plugin MCP servers in the plugin folder (`cwd: "."`), because it does not expand a
 * plugin-root variable in `.mcp.json`. It sends the session's directory with every tools/call: as
 * `sandboxCwd` to servers that declare the `codex/sandbox-state-meta` capability, and as the one
 * key of `x-codex-turn-metadata.workspaces`. Claude Code starts servers in the session directory,
 * so process.cwd() is right there and this returns undefined.
 */
export function sessionCwdFromMeta(meta: unknown): string | undefined {
  if (!meta || typeof meta !== "object") {
    return undefined;
  }
  const fields = meta as Record<string, unknown>;
  return sandboxCwd(fields) ?? turnWorkspaceCwd(fields);
}

/** `sandboxCwd` from either Codex sandbox-state key, as a path. */
function sandboxCwd(fields: Record<string, unknown>): string | undefined {
  for (const key of ["codex/sandbox-state-meta", "codex/sandbox-state"]) {
    const cwd = (fields[key] as { sandboxCwd?: unknown } | undefined)?.sandboxCwd;
    if (typeof cwd === "string" && cwd !== "") {
      const path = toPath(cwd);
      if (path !== undefined) {
        return path;
      }
    }
  }
  return undefined;
}

function toPath(cwd: string): string | undefined {
  try {
    return cwd.startsWith("file:") ? fileURLToPath(cwd) : cwd;
  } catch {
    return undefined;
  }
}

/** The directory named by `x-codex-turn-metadata.workspaces`, when it has exactly one. */
function turnWorkspaceCwd(fields: Record<string, unknown>): string | undefined {
  const workspaces = (fields["x-codex-turn-metadata"] as { workspaces?: unknown } | undefined)?.workspaces;
  if (!workspaces || typeof workspaces !== "object") {
    return undefined;
  }
  const keys = Object.keys(workspaces);
  return keys.length === 1 ? keys[0] : undefined;
}

/** Experimental capability that asks Codex to include `codex/sandbox-state-meta` in tools/call `_meta`. */
export const CODEX_SANDBOX_META_CAPABILITY = "codex/sandbox-state-meta";
