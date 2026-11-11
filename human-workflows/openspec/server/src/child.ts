export type Cli = "claude" | "codex";

export const PLUGIN_NAME = "define-openspec-change";
export const DEFAULT_MARKETPLACE = "agent-workflows";

/**
 * Variables that tie a process to the lead's Claude Code session. A child must not inherit them:
 * Claude treats CLAUDE_CODE_CHILD_SESSION as a nested session, and the messaging token belongs to
 * the lead. User configuration such as CLAUDE_CODE_USE_BEDROCK is left alone.
 */
export const SESSION_ENV_VARS = [
  "CLAUDECODE",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_EFFORT",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_PID",
  "CLAUDE_PROJECT_DIR",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_BRIDGE_SESSION_ID",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
];

/** Which CLI leads, from the MCP client's name, with Claude's environment marker as a fallback. */
export function detectLead(clientName: string | undefined, env: NodeJS.ProcessEnv): Cli | undefined {
  const name = (clientName ?? "").toLowerCase();
  if (name.startsWith("claude")) {
    return "claude";
  }
  if (name.startsWith("codex")) {
    return "codex";
  }
  if (env.CLAUDECODE === "1") {
    return "claude";
  }
  return undefined;
}

/** One crosscheck entry from ~/.agent-workflows/config.yaml. See config.ts for how one is chosen. */
export interface CrosscheckChoice {
  cli: Cli;
  model?: string;
  effort: string;
}

/** Marketplace names this plugin may be installed under: the default, and the one in our own cache path. */
export function marketplaceNames(pluginRoot: string): string[] {
  const names = [DEFAULT_MARKETPLACE];
  const match = pluginRoot.match(new RegExp(`/plugins/cache/([^/]+)/${PLUGIN_NAME}(?:/|$)`));
  if (match?.[1] && !names.includes(match[1])) {
    names.push(match[1]);
  }
  return names;
}

export interface ChildCommand {
  command: string;
  args: string[];
}

export interface ChildInput extends CrosscheckChoice {
  prompt: string;
  pluginRoot: string;
  /** Codex writes its final message here. */
  lastMessageFile: string;
}

/**
 * The read-only crosscheck command line. Neither child can reach this plugin's tools: the Claude
 * child loads no settings, plugins, or MCP servers and only read-only built-in tools; the Codex child
 * is sandboxed read-only and has this plugin turned off. Both read skills by absolute path.
 */
export function childCommand(input: ChildInput): ChildCommand {
  if (input.cli === "codex") {
    const args = ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "-s", "read-only"];
    args.push("-c", `model_reasoning_effort="${input.effort}"`);
    if (input.model) {
      args.push("-m", input.model);
    }
    // Codex 0.166 splits -c keys on dots and keeps quotes as part of the key, so the quoted TOML
    // form `plugins."name@market"` is silently ignored. The unquoted key works; a marketplace name
    // with a dot in it cannot be written this way.
    for (const marketplace of marketplaceNames(input.pluginRoot)) {
      if (!marketplace.includes(".")) {
        args.push("-c", `plugins.${PLUGIN_NAME}@${marketplace}.enabled=false`);
      }
    }
    args.push("-o", input.lastMessageFile, "--", input.prompt);
    return { command: "codex", args };
  }
  const tools = ["Read", "Grep", "Glob", "WebSearch", "WebFetch"];
  const args = [
    "-p",
    "--output-format",
    "json",
    "--no-session-persistence",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--tools",
    tools.join(","),
    "--allowedTools",
    ...tools,
    "--add-dir",
    input.pluginRoot,
    "--effort",
    input.effort,
  ];
  if (input.model) {
    args.push("--model", input.model);
  }
  args.push("--", input.prompt);
  return { command: "claude", args };
}

export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = { ...env };
  for (const name of SESSION_ENV_VARS) {
    delete clean[name];
  }
  return clean;
}
