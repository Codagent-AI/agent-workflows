import assert from "node:assert/strict";
import { mkdirSync, readdirSync, statSync, symlinkSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { STATE_FILE } from "../src/state.js";
import { spawnLogged } from "../src/callchild.js";
import { readConfig } from "../src/config.js";
import { workingTreeFingerprint } from "../src/worktree.js";
import { CHANGE, fakeCall, fakeLog, makeContext, makeFixture, pathWithout, session, writeArtifacts, writeConfig } from "./helpers.js";

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

/** Polls get_agent_call until the call is no longer running. */
async function settled(calls: ReturnType<typeof session>["calls"], callId: unknown) {
  let polled = parse(await calls.get(String(callId)));
  for (let i = 0; i < 20 && polled.status === "running"; i++) {
    polled = parse(await calls.get(String(callId)));
  }
  return polled;
}

async function atProposal(options: Parameters<typeof makeContext>[1] = {}, fixtureOptions: Parameters<typeof makeFixture>[0] = {}) {
  const fixture = makeFixture(fixtureOptions);
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

  const child = fakeCall(fixture, "codex");
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

  const child = fakeCall(fixture, "claude");
  assert.deepEqual(child.args, [
    "-p",
    "--output-format",
    "json",
    "--no-session-persistence",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--tools",
    "Read,Grep,Glob,WebSearch",
    "--allowedTools",
    "Read",
    "Grep",
    "Glob",
    "WebSearch",
    "--add-dir",
    context.pluginRoot,
    "--effort",
    "high",
    "--",
    "Review the proposal.",
  ]);
});

test("the other CLI's config entry sets the child's model and effort", async () => {
  const config = "human-workflows:\n  crosscheck:\n    - cli: claude\n      model: opus\n      effort: high\n    - cli: codex\n      model: gpt-6-astra\n      effort: xhigh\n";
  const { fixture, calls } = await atProposal({ client: "claude-code" }, { config });
  const body = parse(await calls.start("crosscheck", "Review."));
  assert.equal(body.cli, "codex");
  assert.equal(body.model, "gpt-6-astra");
  assert.equal(body.effort, "xhigh");
  const args = fakeCall(fixture, "codex").args;
  assert.deepEqual(args.slice(args.indexOf("-c"), args.indexOf("-c") + 4), ["-c", 'model_reasoning_effort="xhigh"', "-m", "gpt-6-astra"]);
});

test("with only the lead's CLI in the config, the crosscheck runs on the lead's CLI", async () => {
  const config = "human-workflows:\n  crosscheck:\n    - cli: claude\n      model: sonnet\n      effort: medium\n";
  const { fixture, calls } = await atProposal({ client: "claude-code" }, { config });
  const body = parse(await calls.start("crosscheck", "Review."));
  assert.equal(body.cli, "claude");
  assert.equal(body.model, "sonnet");
  assert.equal(body.effort, "medium");
  const args = fakeCall(fixture, "claude").args;
  assert.deepEqual(args.slice(args.indexOf("--effort"), args.indexOf("--effort") + 4), ["--effort", "medium", "--model", "sonnet"]);
  assert.equal(fakeLog(fixture).some((entry) => entry.bin === "codex"), false);
});

test("the lead's own CLI is used when the other CLI is configured but not installed", async () => {
  const fixture = makeFixture();
  const context = makeContext(fixture, { client: "codex-mcp-client" });
  const s = session(context);
  await s.next({ change_name: CHANGE, start: true });
  const noClaude = session({ ...context, env: { ...context.env, PATH: pathWithout(fixture, ["claude"]) } });
  const body = parse(await noClaude.calls.start("crosscheck", "Review."));
  assert.equal(body.status, "succeeded");
  assert.equal(body.cli, "codex");
});

test("an unknown lead uses the first configured CLI that is installed", async () => {
  const { calls } = await atProposal({ client: "some-other-client" });
  const body = parse(await calls.start("crosscheck", "Review."));
  assert.equal(body.cli, "codex");
});

test("call_agent without a usable config is refused and points at the setup skill", async () => {
  const { fixture, calls } = await atProposal({ client: "claude-code" });
  writeConfig(fixture, null);
  const missing = parse(await calls.start("crosscheck", "Review."));
  assert.equal(missing.error?.code, "crosscheck_not_configured");
  assert.match(missing.error?.message ?? "", /~\/\.agent-workflows\/config\.yaml/);
  assert.match(missing.error?.message ?? "", /define-openspec-change:setup/);
  assert.equal(fakeLog(fixture).some((entry) => entry.bin === "codex" || entry.bin === "claude"), false);
});

test("the config is checked: a crosscheck list of claude and codex entries with only cli, model, and effort", () => {
  const fixture = makeFixture();
  const read = (text: string) => {
    writeConfig(fixture, text);
    return readConfig(fixture.env);
  };
  const ok = read("human-workflows:\n  crosscheck:\n    - cli: codex\n      model: gpt-6-astra\n    - cli: claude\n");
  assert.deepEqual(ok.ok && ok.crosscheck, [
    { cli: "codex", model: "gpt-6-astra", effort: "high" },
    { cli: "claude", effort: "high" },
  ]);
  const problems: Array<[string, RegExp]> = [
    ["human-workflows:\n  crosscheck: []\n", /needs a `human-workflows.crosscheck` list/],
    ["human-workflows:\n  crosscheck:\n    cli: codex\n", /needs a `human-workflows.crosscheck` list/],
    ["human-workflows: {}\n", /needs a `human-workflows.crosscheck` list/],
    ["factory-workflows: {}\n", /needs a `human-workflows.crosscheck` list/],
    ["crosscheck:\n  - cli: codex\n", /goes under `human-workflows`/],
    ["crosscheck:\n  - cli: claude\nhuman-workflows:\n  crosscheck:\n    - cli: codex\n", /goes under `human-workflows`/],
    ["human-workflows:\n  crosscheck:\n    - cli: gemini\n", /cli: claude or cli: codex/],
    ["human-workflows:\n  crosscheck:\n    - cli: codex\n    - cli: codex\n", /more than one `human-workflows.crosscheck` entry has cli: codex/],
    ["human-workflows:\n  crosscheck:\n    - cli: codex\n      reasoning: high\n", /unknown keys: reasoning/],
    ["human-workflows:\n  crosscheck:\n    - cli: codex\n      model: ''\n", /non-empty text/],
    ["human-workflows:\n  crosscheck: [\n", /not valid/],
  ];
  for (const [text, pattern] of problems) {
    const result = read(text);
    assert.equal(result.ok, false, text);
    assert.match(result.ok ? "" : result.message, pattern, text);
  }
  const withFactory = read(
    "human-workflows:\n  crosscheck:\n    - cli: codex\n" +
      "factory-workflows:\n  anything: [1, {a: b}]\n  other:\n    nested: true\n",
  );
  assert.deepEqual(withFactory.ok && withFactory.crosscheck, [{ cli: "codex", effort: "high" }]);
  writeConfig(fixture, null);
  const missing = readConfig(fixture.env);
  assert.equal(!missing.ok && missing.reason, "missing");
});

test("the Codex child turns off the marketplace this plugin was installed from", async () => {
  const fixture = makeFixture();
  const context = makeContext(fixture, { client: "claude-code" });
  const { next } = session(context);
  await next({ change_name: CHANGE, start: true });
  const cached = session({ ...context, pluginRoot: `${context.pluginRoot}/../../../plugins/cache/my-market/define-openspec-change/0.1.0` });
  // The step prompt files are not under the fake cache path, but the child command is built before they matter.
  await cached.calls.start("crosscheck", "Review.");
  const args = fakeCall(fixture, "codex").args;
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

  const polled = await settled(calls, started.call_id);
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

test("bad targets, empty prompts, and unknown calls are refused", async () => {
  const { calls, fixture } = await atProposal({ client: "claude-code" });
  assert.equal(parse(await calls.start("reviewer", "Review.")).error?.code, "invalid_target");
  assert.equal(parse(await calls.start("crosscheck", "   ")).error?.code, "invalid_request");
  assert.equal(parse(await calls.get("call-00000000")).error?.code, "unknown_call");
  assert.equal(parse(await calls.cancel("call-00000000")).error?.code, "unknown_call");
  assert.equal(fakeLog(fixture).some((entry) => entry.bin === "codex" || entry.bin === "claude"), false);
});

test("overlapping call_agent requests start only one child", async () => {
  const { calls, fixture } = await atProposal({ waitMs: 50, extraEnv: { FAKE_CHILD_SLEEP_MS: "400" } });
  const results = await Promise.all([calls.start("crosscheck", "One."), calls.start("crosscheck", "Two.")]);
  const codes = results.map((result) => parse(result).error?.code ?? parse(result).status).sort();
  assert.deepEqual(codes, ["call_in_progress", "running"]);
  await settled(calls, parse(results.find((r) => !r.isError) ?? results[0]).call_id);
  assert.equal(fakeLog(fixture).filter((entry) => entry.bin === "codex").length, 1);
});

test("with two defines in progress, call_agent needs change_name", async () => {
  const { calls, next, fixture } = await atProposal();
  await next({ change_name: "other-change", start: true });
  const ambiguous = await calls.start("crosscheck", "Review.");
  assert.equal(parse(ambiguous).error?.code, "ambiguous_change");
  assert.match(parse(ambiguous).error?.message ?? "", /add-reading-time, other-change/);

  const named = parse(await calls.start("crosscheck", "Review.", fixture.repo, "other-change"));
  assert.equal(named.status, "succeeded");
  const other = JSON.parse(fixture.read(`openspec/changes/other-change/${STATE_FILE}`));
  const first = JSON.parse(fixture.read(`openspec/changes/${CHANGE}/${STATE_FILE}`));
  assert.equal(other.calls.length, 1);
  assert.equal(first.calls.length, 0);

  const unknown = await calls.start("crosscheck", "Review.", fixture.repo, "no-such-change");
  assert.equal(parse(unknown).error?.code, "call_agent_unavailable");
});

test("killAll kills a child that ignores SIGTERM", async () => {
  const { calls } = await atProposal({ waitMs: 100, extraEnv: { FAKE_CHILD_SLEEP_MS: "30000", FAKE_CHILD_IGNORE_TERM: "1" } });
  const started = parse(await calls.start("crosscheck", "Review."));
  assert.equal(started.status, "running");
  await calls.killAll(200);
  const polled = await settled(calls, started.call_id);
  assert.equal(polled.status, "canceled");
});

test("a call stays running until its working-tree check is done", async () => {
  const { calls } = await atProposal({ extraEnv: { FAKE_CHILD_WRITE: "child-was-here.txt", FAKE_CHILD_SLEEP_MS: "100" }, waitMs: 20 });
  const started = parse(await calls.start("crosscheck", "Review."));
  const id = String(started.call_id);
  while (calls.running()) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(parse(await calls.get(id)).working_tree, "changed");
});

test("call logs are private to the user, even in a folder that already existed", async () => {
  const fixture = makeFixture();
  const context = makeContext(fixture);
  mkdirSync(context.logBase, { mode: 0o755 });
  const s = session(context);
  await s.next({ change_name: CHANGE, start: true });
  const body = parse(await s.calls.start("crosscheck", "Review."));
  const repoDir = join(context.logBase, readdirSync(context.logBase).filter((name) => !name.endsWith(".log"))[0] ?? "");
  const callDir = join(repoDir, String(body.call_id));
  const mode = (path: string) => statSync(path).mode & 0o777;
  assert.equal(mode(context.logBase), 0o700);
  assert.equal(mode(repoDir), 0o700);
  assert.equal(mode(callDir), 0o700);
  for (const file of ["prompt.txt", "command.json", "stdout", "stderr"]) {
    assert.equal(mode(join(callDir, file)), 0o600, file);
  }
});

test("a log file that cannot be opened closes the one that was", () => {
  const fixture = makeFixture();
  const dir = join(fixture.dir, "call-logs");
  mkdirSync(join(dir, "stderr"), { recursive: true });
  const open = () => readdirSync("/dev/fd").length;
  const before = open();
  assert.throws(() => spawnLogged({ command: "true", args: [] }, dir, fixture.repo, fixture.env));
  assert.equal(open(), before);
});

test("the working-tree fingerprint sees a retargeted symlink and is unknown when git cannot compare", async () => {
  const fixture = makeFixture();
  mkdirSync(join(fixture.repo, "a"));
  mkdirSync(join(fixture.repo, "b"));
  symlinkSync("a", join(fixture.repo, "link"));
  const before = await workingTreeFingerprint(fixture.repo, fixture.env);
  rmSync(join(fixture.repo, "link"));
  symlinkSync("b", join(fixture.repo, "link"));
  const after = await workingTreeFingerprint(fixture.repo, fixture.env);
  assert.ok(before && after);
  assert.notEqual(before, after);

  const unborn = join(fixture.dir, "unborn");
  mkdirSync(unborn);
  fixture.git("-C", unborn, "init", "-q");
  writeFileSync(join(unborn, "file.txt"), "x\n");
  assert.equal(await workingTreeFingerprint(unborn, fixture.env), undefined);
});
