import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { CHANGE, fakeLog, makeFixture, PLUGIN_ROOT, writeArtifacts } from "./helpers.js";

type TextResult = { content: Array<{ type: string; text?: string }>; isError?: boolean };

function text(result: unknown): string {
  return (result as TextResult).content.map((part) => part.text ?? "").join("");
}

async function connect(fixture: ReturnType<typeof makeFixture>, clientName: string, cwd = fixture.repo) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(PLUGIN_ROOT, "server.mjs")],
    cwd,
    env: { ...(fixture.env as Record<string, string>), DEFINE_OPENSPEC_CHANGE_WAIT_SECONDS: "5" },
    stderr: "pipe",
  });
  const client = new Client({ name: clientName, version: "0.0.0" });
  await client.connect(transport);
  return client;
}

test("the committed bundle serves the four tools over stdio", async () => {
  const fixture = makeFixture();
  const client = await connect(fixture, "claude-code");
  try {
    const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
    assert.deepEqual(tools, ["call_agent", "cancel_agent_call", "get_agent_call", "next_step"]);

    const started = await client.callTool({ name: "next_step", arguments: { change_name: CHANGE, start: true } });
    assert.equal((started as TextResult).isError, undefined);
    assert.match(text(started), /The current step is "proposal" \(step 1 of 5\)/);
    assert.ok(text(started).includes(join(PLUGIN_ROOT, "skills", "proposal-review", "SKILL.md")));

    const early = await client.callTool({ name: "next_step", arguments: { change_name: CHANGE } });
    assert.equal((early as TextResult).isError, true);
    assert.match(text(early), /^Refused: step "proposal"/);

    writeArtifacts(fixture, CHANGE, "proposal");
    const review = JSON.parse(text(await client.callTool({ name: "call_agent", arguments: { agent: "crosscheck", prompt: "Review." } })));
    assert.equal(review.status, "succeeded");
    assert.equal(review.cli, "codex", "the client name claude-code makes Codex the crosscheck");

    const specs = await client.callTool({ name: "next_step", arguments: {} });
    assert.match(text(specs), /^Continuing to step "specs"/);
  } finally {
    await client.close();
  }
  assert.equal(fakeLog(fixture).filter((entry) => entry.bin === "codex").length, 1);
});

test("a codex client gets a Claude crosscheck through the bundle", async () => {
  const fixture = makeFixture();
  const client = await connect(fixture, "codex-mcp-client");
  try {
    await client.callTool({ name: "next_step", arguments: { change_name: CHANGE, start: true } });
    const review = JSON.parse(text(await client.callTool({ name: "call_agent", arguments: { agent: "crosscheck", prompt: "Review." } })));
    assert.equal(review.cli, "claude");
    assert.equal(review.status, "succeeded");
  } finally {
    await client.close();
  }
});

test("started in the plugin folder as Codex does, it works in the session directory from _meta", async () => {
  const fixture = makeFixture();
  const client = await connect(fixture, "codex-mcp-client", PLUGIN_ROOT);
  const _meta = {
    "x-codex-turn-metadata": { workspaces: { [fixture.repo]: { has_changes: false } } },
    "codex/sandbox-state-meta": { sandboxCwd: pathToFileURL(fixture.repo).href },
  };
  try {
    const started = await client.callTool({ name: "next_step", arguments: { change_name: CHANGE, start: true }, _meta });
    assert.equal((started as TextResult).isError, undefined, text(started));
    assert.equal(JSON.parse(fixture.read(`openspec/changes/${CHANGE}/.define-openspec-change.json`)).current_step, "proposal");

    const turnOnly = { "x-codex-turn-metadata": _meta["x-codex-turn-metadata"] };
    const early = await client.callTool({ name: "next_step", arguments: { change_name: CHANGE }, _meta: turnOnly });
    assert.match(text(early), /^Refused: step "proposal"/);

    const review = JSON.parse(text(await client.callTool({ name: "call_agent", arguments: { agent: "crosscheck", prompt: "Review." }, _meta })));
    assert.equal(review.status, "succeeded");
    const child = fakeLog(fixture).find((entry) => entry.bin === "claude")!;
    assert.equal(child.cwd, fixture.repo);
  } finally {
    await client.close();
  }
});
