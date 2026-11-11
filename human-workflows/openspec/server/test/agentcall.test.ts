import assert from "node:assert/strict";
import { test } from "node:test";

import { STATE_FILE } from "../src/state.js";
import { CHANGE, fakeLog, makeContext, makeFixture, session, writeArtifacts } from "./helpers.js";

const SESSION_VARS = {
  CLAUDECODE: "1",
  CLAUDE_CODE_SESSION_ATTENDED: "1",
  CLAUDE_EFFORT: "high",
  CLAUDE_CODE_CHILD_SESSION: "1",
  CLAUDE_CODE_ENTRYPOINT: "cli",
  CLAUDE_CODE_SESSION_ID: "lead-session",
  CLAUDE_CODE_MESSAGING_TOKEN: "secret",
  CLAUDE_PROJECT_DIR: "/somewhere",
  CLAUDE_CODE_USE_BEDROCK: "0",
};

function parse(result: { text: string }) {
  return JSON.parse(result.text) as Record<string, unknown> & { error?: { code: string; message: string } };
}

async function atProposal(options: Parameters<typeof makeContext>[1] = {}) {
  const fixture = makeFixture();
  const context = makeContext(fixture, options);
  const s = session(context);
  await s.next({ change_name: CHANGE, start: true });
  return { fixture, context, ...s };
}

test("a Claude lead gets a read-only Codex child with this plugin turned off", async () => {
  const { fixture, context, calls } = await atProposal({ client: "claude-code", extraEnv: SESSION_VARS });
  const result = await calls.start("crosscheck", "Review the proposal.");
  const body = parse(result);

  assert.equal(body.status, "succeeded");
  assert.equal(body.cli, "codex");
  assert.equal(body.model, "default");
  assert.equal(body.response, "codex review: no consequential findings.");
  assert.equal(body.working_tree, "unchanged");

  const child = fakeLog(fixture).find((entry) => entry.bin === "codex")!;
  const lastMessage = child.args[child.args.indexOf("-o") + 1];
  assert.deepEqual(child.args, [
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "-s",
    "read-only",
    "-c",
    'model_reasoning_effort="high"',
    "-c",
    'plugins.define-openspec-change@agent-workflows.enabled=false',
    "-o",
    lastMessage,
    "--",
    "Review the proposal.",
  ]);
  assert.ok(lastMessage?.startsWith(context.logBase), "child output stays outside the worktree");
  assert.equal(child.cwd, fixture.repo);
  assert.deepEqual(child.env?.filter((name) => name.startsWith("CLAUDE")), ["CLAUDE_CODE_USE_BEDROCK"]);
});

test("a Codex lead gets a Claude child with no settings, no MCP servers, and read-only tools", async () => {
  const { fixture, context, calls } = await atProposal({ client: "codex-mcp-client" });
  const body = parse(await calls.start("crosscheck", "Review the proposal."));
  assert.equal(body.status, "succeeded");
  assert.equal(body.cli, "claude");
  assert.equal(body.cost_usd, 0.25);

  const child = fakeLog(fixture).find((entry) => entry.bin === "claude")!;
  assert.deepEqual(child.args, [
    "-p",
    "--output-format",
    "json",
    "--no-session-persistence",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--tools",
    "Read,Grep,Glob,WebSearch,WebFetch",
    "--allowedTools",
    "Read",
    "Grep",
    "Glob",
    "WebSearch",
    "WebFetch",
    "--add-dir",
    context.pluginRoot,
    "--effort",
    "high",
    "--",
    "Review the proposal.",
  ]);
});

test("crosscheck CLI, model, and effort can be overridden", async () => {
  const { fixture, calls } = await atProposal({
    client: "claude-code",
    extraEnv: {
      DEFINE_OPENSPEC_CHANGE_CROSSCHECK_CLI: "claude",
      DEFINE_OPENSPEC_CHANGE_CROSSCHECK_MODEL: "sonnet",
      DEFINE_OPENSPEC_CHANGE_CROSSCHECK_EFFORT: "medium",
    },
  });
  const body = parse(await calls.start("crosscheck", "Review."));
  assert.equal(body.cli, "claude");
  assert.equal(body.model, "sonnet");
  assert.equal(body.effort, "medium");
  const args = fakeLog(fixture).find((entry) => entry.bin === "claude")!.args;
  assert.deepEqual(args.slice(args.indexOf("--effort"), args.indexOf("--effort") + 4), ["--effort", "medium", "--model", "sonnet"]);
});

test("the Codex child turns off the marketplace this plugin was installed from", async () => {
  const fixture = makeFixture();
  const context = makeContext(fixture, { client: "claude-code" });
  const { next } = session(context);
  await next({ change_name: CHANGE, start: true });
  const cached = session({ ...context, pluginRoot: `${context.pluginRoot}/../../../plugins/cache/my-market/define-openspec-change/0.1.0` });
  // The step prompt files are not under the fake cache path, but the child command is built before they matter.
  await cached.calls.start("crosscheck", "Review.");
  const args = fakeLog(fixture).find((entry) => entry.bin === "codex")!.args;
  assert.ok(args.includes('plugins.define-openspec-change@agent-workflows.enabled=false'));
  assert.ok(args.includes('plugins.define-openspec-change@my-market.enabled=false'));
});

test("a slow child returns running, then get_agent_call returns the result", async () => {
  const { calls, fixture } = await atProposal({ waitMs: 100, extraEnv: { FAKE_CHILD_SLEEP_MS: "700" } });
  const started = parse(await calls.start("crosscheck", "Review."));
  assert.equal(started.status, "running");
  assert.match(String(started.call_id), /^call-[0-9a-f]{8}$/);
  assert.match(String(started.next), /get_agent_call/);
  assert.equal(started.response, undefined);

  const busy = await calls.start("crosscheck", "Another review.");
  assert.equal(busy.isError, true);
  assert.equal(parse(busy).error?.code, "call_in_progress");
  assert.equal(parse(busy).call_id, started.call_id);

  let polled = parse(await calls.get(String(started.call_id)));
  for (let i = 0; i < 20 && polled.status === "running"; i++) {
    polled = parse(await calls.get(String(started.call_id)));
  }
  assert.equal(polled.status, "succeeded");
  assert.equal(polled.response, "codex review: no consequential findings.");
  assert.equal(fakeLog(fixture).filter((entry) => entry.bin === "codex").length, 1);

  const cached = parse(await calls.get(String(started.call_id)));
  assert.deepEqual(cached, polled);
});

test("next_step is refused while a call is running", async () => {
  const { calls, next, fixture } = await atProposal({ waitMs: 50, extraEnv: { FAKE_CHILD_SLEEP_MS: "600" } });
  writeArtifacts(fixture, CHANGE, "proposal");
  const started = parse(await calls.start("crosscheck", "Review."));
  const refused = await next({ change_name: CHANGE });
  assert.equal(refused.isError, true);
  assert.match(refused.text, new RegExp(`crosscheck call ${started.call_id} is still running`));
  let polled = parse(await calls.get(String(started.call_id)));
  while (polled.status === "running") polled = parse(await calls.get(String(started.call_id)));
  const advanced = await next({ change_name: CHANGE });
  assert.match(advanced.text, /^Continuing to step "specs"/);
});

test("cancel stops a running child", async () => {
  const { calls } = await atProposal({ waitMs: 100, extraEnv: { FAKE_CHILD_SLEEP_MS: "30000" } });
  const started = parse(await calls.start("crosscheck", "Review."));
  assert.equal(started.status, "running");
  let canceled = parse(await calls.cancel(String(started.call_id)));
  for (let i = 0; i < 20 && canceled.status === "running"; i++) {
    canceled = parse(await calls.get(String(started.call_id)));
  }
  assert.equal(canceled.status, "canceled");
  assert.equal(canceled.error?.code, "call_canceled");
  assert.equal(calls.running(), undefined, "the slot is free after the cancel settles");
});

test("a failing child is reported as failed with its error", async () => {
  const { calls } = await atProposal({ extraEnv: { FAKE_CHILD_EXIT: "1" } });
  const result = await calls.start("crosscheck", "Review.");
  assert.equal(result.isError, true);
  const body = parse(result);
  assert.equal(body.status, "failed");
  assert.equal(body.error?.code, "execution_failed");
  assert.match(body.error?.message ?? "", /codex ended with exit code 1 and no final message\. model overloaded/);
});

test("a child that changes the working tree is reported", async () => {
  const { calls } = await atProposal({ extraEnv: { FAKE_CHILD_WRITE: "child-was-here.txt" } });
  const body = parse(await calls.start("crosscheck", "Review."));
  assert.equal(body.status, "succeeded");
  assert.equal(body.working_tree, "changed");
});

test("finished calls are recorded in the state file", async () => {
  const { calls, fixture } = await atProposal();
  const body = parse(await calls.start("crosscheck", "Review."));
  const state = JSON.parse(fixture.read(`openspec/changes/${CHANGE}/${STATE_FILE}`));
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].call_id, body.call_id);
  assert.equal(state.calls[0].step, "proposal");
  assert.equal(state.calls[0].cli, "codex");
  assert.equal(state.calls[0].status, "succeeded");
  assert.equal(state.calls[0].working_tree, "unchanged");
});

test("call_agent is refused outside the proposal and approach-review steps", async () => {
  const fixture = makeFixture();
  const { calls, next } = session(makeContext(fixture));
  const none = await calls.start("crosscheck", "Review.");
  assert.equal(parse(none).error?.code, "call_agent_unavailable");

  await next({ change_name: CHANGE, start: true });
  writeArtifacts(fixture, CHANGE, "proposal");
  await next({ change_name: CHANGE });
  const atSpecs = await calls.start("crosscheck", "Review.");
  assert.equal(atSpecs.isError, true);
  assert.equal(parse(atSpecs).error?.code, "call_agent_unavailable");
  assert.equal(fakeLog(fixture).some((entry) => entry.bin === "codex"), false);
});

test("bad targets, empty prompts, unknown calls, and an unknown lead are refused", async () => {
  const { calls, fixture } = await atProposal({ client: "some-other-client" });
  assert.equal(parse(await calls.start("reviewer", "Review.")).error?.code, "invalid_target");
  assert.equal(parse(await calls.start("crosscheck", "   ")).error?.code, "invalid_request");
  assert.equal(parse(await calls.get("call-00000000")).error?.code, "unknown_call");
  assert.equal(parse(await calls.cancel("call-00000000")).error?.code, "unknown_call");
  const unknownLead = parse(await calls.start("crosscheck", "Review."));
  assert.equal(unknownLead.error?.code, "invalid_cli");
  assert.match(unknownLead.error?.message ?? "", /DEFINE_OPENSPEC_CHANGE_CROSSCHECK_CLI/);
  assert.equal(fakeLog(fixture).some((entry) => entry.bin === "codex" || entry.bin === "claude"), false);
});
