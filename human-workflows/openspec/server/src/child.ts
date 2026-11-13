export type Cli = "claude" | "codex";

/**
 * Set in the crosscheck child's environment. The server registers no tools when it sees it, so the
 * child cannot reach next_step or call_agent, whichever way the CLI loads this plugin. The Codex
 * manifest lists it in `env_vars` so Codex passes it on to the server.
 */
export const CHILD_ENV_VAR = "DEFINE_OPENSPEC_CHANGE_CHILD";

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

export interface ChildCommand {
  command: string;
  args: string[];
  /** Written to the child's stdin, so it is not in the process list and has no argument size limit. */
  prompt: string;
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
 * is sandboxed read-only, and the server registers no tools when it sees CHILD_ENV_VAR. Both read
 * review instructions by absolute path. Both read the prompt from stdin: `claude -p` does when it is
 * given no prompt argument, and `codex exec` does for a prompt of `-`.
 */
export function childCommand(input: ChildInput): ChildCommand {
  if (input.cli === "codex") {
    const args = ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "-s", "read-only"];
    args.push("-c", `model_reasoning_effort="${input.effort}"`);
    if (input.model) {
      args.push("-m", input.model);
    }
    args.push("-o", input.lastMessageFile, "-");
    return { command: "codex", args, prompt: input.prompt };
  }
  const tools = ["Read", "Grep", "Glob", "WebSearch"];
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
  return { command: "claude", args, prompt: input.prompt };
}

export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = { ...env, [CHILD_ENV_VAR]: "1" };
  for (const name of SESSION_ENV_VARS) {
    delete clean[name];
  }
  return clean;
}
