import type { CrosscheckChoice } from "./config.js";

export type Cli = "claude" | "codex";

/**
 * Set in the crosscheck child's environment. The server registers no tools when it sees it, so the
 * child cannot reach next_step or crosscheck, whichever way the CLI loads this plugin. The Codex
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

const effortKeys = new Map([
  ["claude", "effort"],
  ["codex", "reasoning_effort"],
  ["agy", "thought_level"],
]);

export function effortApplied(cli: string): boolean {
  return effortKeys.has(cli);
}

export interface ChildCommand {
  command: string;
  args: string[];
  prompt: string;
}

export function acpxCommand(choice: CrosscheckChoice, folder: string, prompt: string): ChildCommand {
  const args = ["--format", "json", "--json-strict", "--suppress-reads", "--approve-all", "--timeout", "3660", "--cwd", folder];
  if (choice.model !== undefined) {
    args.push("--model", choice.model);
  }
  args.push(...(choice.cli === "agy" ? ["--agent", "agy acp"] : [choice.cli]), "exec", "-f", "-");
  const key = effortKeys.get(choice.cli);
  if (key !== undefined) {
    args.push("--config-option", `${key}=${choice.effort}`);
  }
  return { command: "acpx", args, prompt };
}

export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = { ...env, [CHILD_ENV_VAR]: "1" };
  for (const name of SESSION_ENV_VARS) {
    delete clean[name];
  }
  return clean;
}
