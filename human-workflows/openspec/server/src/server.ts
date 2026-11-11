import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { CallManager } from "./agentcall.js";
import { CHILD_ENV_VAR } from "./child.js";
import type { Context } from "./context.js";
import { nextStep } from "./define.js";
import type { ToolText } from "./finish.js";
import { CODEX_SANDBOX_META_CAPABILITY, sessionCwdFromMeta } from "./session.js";
import { callAgentStepsText } from "./steps.js";

export const SERVER_NAME = "define";
export const SERVER_VERSION = "0.1.0";

function toResult(result: ToolText) {
  return {
    content: [{ type: "text" as const, text: result.text }],
    ...(result.isError ? { isError: true } : {}),
  };
}

async function guarded(work: () => Promise<ToolText>) {
  try {
    return toResult(await work());
  } catch (error) {
    return toResult({ text: `define-openspec-change internal error: ${(error as Error).stack ?? String(error)}`, isError: true });
  }
}

/** How long a wait lasts, in words, for the tool descriptions. */
function waitText(context: Context): string {
  return `about ${Math.round(context.waitMs / 1000)} seconds`;
}

interface ToolDeps {
  server: McpServer;
  context: Context;
  calls: CallManager;
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
    },
    async (args, extra) => guarded(() => nextStep({ ...context, cwd: cwdFor(extra) }, calls, args)),
  );
}

/** Registers call_agent. */
function registerCallAgent({ server, context, calls, cwdFor }: ToolDeps): void {
  server.registerTool(
    "call_agent",
    {
      title: "Start a crosscheck",
      description:
        'Starts one crosscheck review on the other vendor\'s CLI (Codex when Claude leads, Claude when Codex leads). agent must be "crosscheck". ' +
        "The child is read-only and has no conversation context, so the prompt must be self-contained. Waits up to " + waitText(context) + ": " +
        "returns the child's result if it finished, otherwise status running and a call_id to pass to get_agent_call. A running status " +
        `is never the child's answer. One call at a time. Only available during ${callAgentStepsText(context.workflow)}.`,
      inputSchema: {
        agent: z.string().describe('Must be "crosscheck".'),
        prompt: z.string().describe("The complete, standalone task for the child."),
        change_name: z
          .string()
          .optional()
          .describe("The change the review is for. Needed only when more than one define is in progress."),
      },
    },
    async ({ agent, prompt, change_name }, extra) => guarded(() => calls.start(agent, prompt, cwdFor(extra), change_name)),
  );
}

/** Registers get_agent_call. */
function registerGetAgentCall({ server, context, calls }: ToolDeps): void {
  server.registerTool(
    "get_agent_call",
    {
      title: "Wait for a crosscheck",
      description:
        "Waits up to " + waitText(context) + " for a call started by call_agent and returns its result, or status running if it is still going. " +
        "Call it again until the status is succeeded, failed, or canceled. Does not start another call.",
      inputSchema: { call_id: z.string().describe("The call_id that call_agent returned.") },
      annotations: { readOnlyHint: true },
    },
    async ({ call_id }) => guarded(() => calls.get(call_id)),
  );
}

/** Registers cancel_agent_call. */
function registerCancelAgentCall({ server, calls }: ToolDeps): void {
  server.registerTool(
    "cancel_agent_call",
    {
      title: "Cancel a crosscheck",
      description:
        "Stops a running call_agent child. It can return while the child is still stopping, so poll get_agent_call until the status is terminal before starting another call.",
      inputSchema: { call_id: z.string().describe("The call_id that call_agent returned.") },
    },
    async ({ call_id }) => guarded(() => calls.cancel(call_id)),
  );
}

/** Makes the server answer tools/list with no tools. Used in the crosscheck child, which must not reach the define tools. */
function registerNoTools(server: McpServer): void {
  server.server.registerCapabilities({ tools: {} });
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
}

/** Builds the MCP server. `context.clientName` should read the connected client's name. */
export function createServer(makeContext: (server: McpServer) => Context): { server: McpServer; calls: CallManager } {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { experimental: { [CODEX_SANDBOX_META_CAPABILITY]: {} } } },
  );
  const context = makeContext(server);
  const calls = new CallManager(context);
  if (context.env[CHILD_ENV_VAR]) {
    registerNoTools(server);
    return { server, calls };
  }
  const deps: ToolDeps = { server, context, calls, cwdFor: (extra) => sessionCwdFromMeta(extra._meta) ?? context.cwd };
  registerNextStep(deps);
  registerCallAgent(deps);
  registerGetAgentCall(deps);
  registerCancelAgentCall(deps);
  return { server, calls };
}
