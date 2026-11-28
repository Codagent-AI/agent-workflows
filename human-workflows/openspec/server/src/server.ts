import { resolve } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { CHILD_ENV_VAR } from "./acpx.js";
import type { Context } from "./context.js";
import { CrosscheckManager } from "./crosscheck.js";
import { nextStep } from "./define.js";
import type { ToolText } from "./finish.js";
import { CODEX_SANDBOX_META_CAPABILITY, sessionCwdFromMeta } from "./session.js";

export const SERVER_NAME = "define";

/** Set at build time from plugin/.claude-plugin/plugin.json (see scripts/build.mjs). Unbundled code has none. */
declare const __SERVER_VERSION__: string | undefined;
export const SERVER_VERSION = typeof __SERVER_VERSION__ === "undefined" ? "0.0.0-unbundled" : __SERVER_VERSION__;

function toResult(result: ToolText) {
  return {
    content: [{ type: "text" as const, text: result.text }],
    ...(result.isError ? { isError: true } : {}),
  };
}

/** Runs a tool. An unexpected error goes to the model as its message only; the stack goes to stderr. */
export async function guarded(work: () => Promise<ToolText>) {
  try {
    return toResult(await work());
  } catch (error) {
    const failure = error as Error;
    process.stderr.write(`define-openspec-change internal error: ${failure.stack ?? String(error)}\n`);
    return toResult({ text: `define-openspec-change internal error: ${failure.message ?? String(error)}`, isError: true });
  }
}

/** How long a wait lasts, in words, for the tool descriptions. */
function waitText(context: Context): string {
  return `about ${Math.round(context.waitMs / 1000)} seconds`;
}

interface ToolDeps {
  server: McpServer;
  context: Context;
  calls: CrosscheckManager;
  /** The session directory for a call: from Codex's `_meta`, or where the server started. */
  cwdFor: (extra: { _meta?: unknown }) => string;
}

/** Registers next_step. */
function registerNextStep({ server, context, calls, cwdFor }: ToolDeps): void {
  server.registerTool(
    "next_step",
    {
      title: "Next define step",
      description:
        "Runs the define-openspec-change workflow for an OpenSpec change. Call it with change_name and start: true to begin a define " +
        "or pick up one in progress; it returns the current step's instructions without advancing. Call it again without start when " +
        "the current step is complete: it checks the step's artifact and returns the next step's instructions, or refuses and says " +
        "what is missing. After the last step it validates the change and commits its documents. Carry out every result it returns.",
      inputSchema: {
        change_name: z
          .string()
          .optional()
          .describe("The OpenSpec change name (lowercase letters, digits, hyphens). May be left out when exactly one define is in progress."),
        start: z
          .boolean()
          .optional()
          .describe("true to start a new define or resume one in progress. Leave it out to complete the current step."),
      },
      // The last call commits, pushes the branch and opens a pull request.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (args, extra) => guarded(() => nextStep({ ...context, cwd: cwdFor(extra) }, calls, args)),
  );
}

function registerCrosscheck({ server, context, calls }: ToolDeps): void {
  server.registerTool(
    "crosscheck",
    {
      title: "Start a crosscheck",
      description:
        "Use only when a review step or the crosscheck skill asks. Starts the configured reviewers together with your exact prompt. " +
        "Make the prompt self-contained and strictly instruct reviewers to change nothing. Waits up to " + waitText(context) +
        " for the result or returns running and a crosscheck_id for get_crosscheck. One crosscheck runs at a time.",
      inputSchema: {
        prompt: z.string().describe("The complete, standalone task for all reviewers."),
        change_name: z.string().optional().describe("Name an in-progress define to record the crosscheck there."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ prompt, change_name }, extra) => guarded(() => {
      const sessionCwd = sessionCwdFromMeta(extra._meta);
      const fallback = resolve(context.cwd) === resolve(context.pluginRoot) ? null : context.cwd;
      return calls.start(prompt, sessionCwd ?? fallback, change_name);
    }),
  );
}

function registerGetCrosscheck({ server, context, calls }: ToolDeps): void {
  server.registerTool(
    "get_crosscheck",
    {
      title: "Wait for a crosscheck",
      description: `Waits up to ${waitText(context)} for the crosscheck result. Poll while the status is running.`,
      inputSchema: { crosscheck_id: z.string().describe("The ID returned by crosscheck.") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ crosscheck_id }) => guarded(() => calls.get(crosscheck_id)),
  );
}

function registerCancelCrosscheck({ server, calls }: ToolDeps): void {
  server.registerTool(
    "cancel_crosscheck",
    {
      title: "Cancel a crosscheck",
      description: "Stops the running reviewers. If still running, poll get_crosscheck until cancellation finishes.",
      inputSchema: { crosscheck_id: z.string().describe("The ID returned by crosscheck.") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ crosscheck_id }) => guarded(() => calls.cancel(crosscheck_id)),
  );
}

/** Makes the server answer tools/list with no tools. Used in the crosscheck child, which must not reach the define tools. */
function registerNoTools(server: McpServer): void {
  server.server.registerCapabilities({ tools: {} });
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
}

/** Builds the MCP server. `context.clientName` should read the connected client's name. */
export function createServer(makeContext: (server: McpServer) => Context): { server: McpServer; calls: CrosscheckManager } {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { experimental: { [CODEX_SANDBOX_META_CAPABILITY]: {} } } },
  );
  const context = makeContext(server);
  const calls = new CrosscheckManager(context);
  if (context.env[CHILD_ENV_VAR]) {
    registerNoTools(server);
    return { server, calls };
  }
  const deps: ToolDeps = { server, context, calls, cwdFor: (extra) => sessionCwdFromMeta(extra._meta) ?? context.cwd };
  registerNextStep(deps);
  registerCrosscheck(deps);
  registerGetCrosscheck(deps);
  registerCancelCrosscheck(deps);
  return { server, calls };
}
