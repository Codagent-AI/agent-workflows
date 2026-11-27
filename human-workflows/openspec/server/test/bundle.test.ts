import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { CHANGE, fakeCall, makeFixture, PLUGIN_ROOT } from "./helpers.js";

type TextResult = { content: Array<{ type: string; text?: string }>; isError?: boolean };

function text(result: unknown): string {
  return (result as TextResult).content.map((part) => part.text ?? "").join("");
}

async function connect(fixture: ReturnType<typeof makeFixture>, clientName: string, cwd = fixture.repo, extraEnv: Record<string, string> = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(PLUGIN_ROOT, "server.mjs")],
    cwd,
    env: { ...(fixture.env as Record<string, string>), DEFINE_OPENSPEC_CHANGE_WAIT_SECONDS: "0.03", ...extraEnv },
    stderr: "pipe",
  });
  const client = new Client({ name: clientName, version: "0.0.0" });
  await client.connect(transport);
  return client;
}

async function poll(client: Client, crosscheck_id: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = JSON.parse(text(await client.callTool({ name: "get_crosscheck", arguments: { crosscheck_id } })));
    if (result.status !== "running") return result;
  }
  return assert.fail(`crosscheck ${crosscheck_id} did not settle`);
}

test("E2E-1: the committed server exposes the four tools and runs, polls and cancels over stdio", async () => {
  const fixture = makeFixture({ config: "human-workflows:\n  crosscheck:\n    - cli: codex\n    - cli: agy\n" });
  const client = await connect(fixture, "claude-code", fixture.repo, {
    FAKE_REVIEWERS: JSON.stringify({ codex: { delay: 400 }, agy: { delay: 400 } }),
  });
  try {
    const tools = new Map((await client.listTools()).tools.map((tool) => [tool.name, tool]));
    assert.deepEqual([...tools.keys()].sort(), ["cancel_crosscheck", "crosscheck", "get_crosscheck", "next_step"]);
    const manifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf8")) as { version: string };
    assert.equal(client.getServerVersion()?.version, manifest.version);
    assert.equal(tools.get("next_step")?.annotations?.destructiveHint, true);
    assert.equal(tools.get("get_crosscheck")?.annotations?.readOnlyHint, true);
    assert.equal(tools.get("crosscheck")?.annotations?.readOnlyHint, false);
    assert.deepEqual(Object.keys(tools.get("crosscheck")?.inputSchema.properties ?? {}).sort(), ["change_name", "prompt"]);
    const run = async () => JSON.parse(text(await client.callTool({ name: "crosscheck", arguments: { prompt: "Review." } })));
    const started = await run();
    assert.equal(started.status, "running");
    const result = await poll(client, started.crosscheck_id);
    assert.equal(result.status, "succeeded");
    assert.deepEqual(result.reviewers.map(({ response }: { response: string }) => response), ["codex review", "agy review"]);

    const second = await run();
    assert.equal(second.status, "running");
    await client.callTool({ name: "cancel_crosscheck", arguments: { crosscheck_id: second.crosscheck_id } });
    assert.equal((await poll(client, second.crosscheck_id)).status, "canceled");
  } finally {
    await client.close();
  }
});

test("E2E-1: Codex sandboxCwd resolves the launch folder outside a repository", async () => {
  const fixture = makeFixture();
  const manifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, ".codex-mcp.json"), "utf8"));
  const hostEnv = { ACPX_CLAUDE_INCLUDE_USER_SETTINGS: "1" };
  const forwarded = Object.fromEntries(Object.entries(hostEnv).filter(([name]) => manifest.mcpServers.define.env_vars.includes(name)));
  const client = await connect(fixture, "codex-mcp-client", PLUGIN_ROOT, forwarded);
  const metadata = { "codex/sandbox-state-meta": { sandboxCwd: pathToFileURL(fixture.dir).href } };
  try {
    const missing = await client.callTool({ name: "crosscheck", arguments: { prompt: "Missing metadata." } });
    assert.equal((missing as TextResult).isError, true);
    assert.equal(JSON.parse(text(missing)).error.code, "session_folder_unavailable");
    const review = JSON.parse(text(await client.callTool({ name: "crosscheck", arguments: { prompt: "Review." }, _meta: metadata })));
    const final = review.status === "running" ? await poll(client, review.crosscheck_id) : review;
    assert.equal(final.status, "succeeded");
    assert.equal(final.working_tree, "unknown");
    assert.equal(final.reviewers[0].cli, "claude");
    const child = fakeCall(fixture, "acpx");
    assert.equal(child.cwd, fixture.dir);
    assert.equal(child.env?.ACPX_CLAUDE_INCLUDE_USER_SETTINGS, "1");
    assert.equal(child.args[child.args.indexOf("--cwd") + 1], fixture.dir);
  } finally {
    await client.close();
  }
});

test("Claude Code resolves the session directory from CLAUDE_PROJECT_DIR", async () => {
  const fixture = makeFixture();
  const client = await connect(fixture, "claude-code", fixture.dir, { CLAUDE_PROJECT_DIR: fixture.repo });
  try {
    const started = await client.callTool({ name: "next_step", arguments: { change_name: CHANGE, start: true } });
    assert.equal((started as TextResult).isError, undefined);
    assert.equal(JSON.parse(fixture.read(`openspec/changes/${CHANGE}/.define-openspec-change.json`)).current_step, "proposal");
  } finally {
    await client.close();
  }
});

test("E2E-1: a reviewer server exposes no tools and the Codex manifest forwards marker and wait", async () => {
  const fixture = makeFixture();
  const client = await connect(fixture, "codex-mcp-client", fixture.repo, { DEFINE_OPENSPEC_CHANGE_CHILD: "1" });
  try {
    assert.deepEqual((await client.listTools()).tools, []);
  } finally {
    await client.close();
  }
  const manifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, ".codex-mcp.json"), "utf8"));
  const variables = manifest.mcpServers.define.env_vars;
  assert.ok(variables.includes("DEFINE_OPENSPEC_CHANGE_CHILD"));
  assert.ok(variables.includes("DEFINE_OPENSPEC_CHANGE_WAIT_SECONDS"));
});

test("an internal error shows its message and omits the stack", async () => {
  const { guarded } = await import("../src/server.js");
  const failed = await guarded(async () => {
    throw new Error("boom");
  });
  assert.equal(failed.isError, true);
  assert.equal(failed.content[0]?.text, "define-openspec-change internal error: boom");
});
