import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { defaultLogBase, waitMsFromEnv } from "./context.js";
import { createServer } from "./server.js";

// The bundle lives at <plugin root>/server.mjs.
const pluginRoot = dirname(fileURLToPath(import.meta.url));
const logBase = defaultLogBase();

try {
  mkdirSync(logBase, { recursive: true });
  appendFileSync(
    join(logBase, "server-starts.log"),
    JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ppid: process.ppid, cwd: process.cwd(), pluginRoot }) + "\n",
  );
} catch {
  // Logging never stops the server.
}

const { server, calls } = createServer((mcp) => ({
  cwd: process.cwd(),
  env: process.env,
  pluginRoot,
  waitMs: waitMsFromEnv(process.env),
  logBase,
  clientName: () => mcp.server.getClientVersion()?.name,
  now: () => new Date(),
}));

const shutdown = () => {
  calls.killAll();
  process.exit(0);
};
process.stdin.on("close", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await server.connect(new StdioServerTransport());
