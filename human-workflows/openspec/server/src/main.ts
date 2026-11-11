import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { defaultLogBase, ensurePrivateDir, waitMsFromEnv } from "./context.js";
import { createServer } from "./server.js";
import { loadWorkflow, WorkflowError } from "./steps.js";

// The bundle lives at <plugin root>/server.mjs.
const pluginRoot = dirname(fileURLToPath(import.meta.url));
const logBase = defaultLogBase();

let workflow: ReturnType<typeof loadWorkflow>;
try {
  workflow = loadWorkflow(pluginRoot);
} catch (error) {
  if (error instanceof WorkflowError) {
    process.stderr.write(`define-openspec-change: ${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

try {
  ensurePrivateDir(logBase);
  appendFileSync(
    join(logBase, "server-starts.log"),
    `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ppid: process.ppid, cwd: process.cwd(), pluginRoot })}\n`,
    { mode: 0o600 },
  );
} catch {
  // Logging never stops the server.
}

const { server, calls } = createServer((mcp) => ({
  cwd: process.cwd(),
  env: process.env,
  pluginRoot,
  workflow,
  waitMs: waitMsFromEnv(process.env),
  logBase,
  clientName: () => mcp.server.getClientVersion()?.name,
  now: () => new Date(),
}));

const shutdown = () => {
  void calls.killAll().finally(() => process.exit(0));
};
process.stdin.on("close", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await server.connect(new StdioServerTransport());
