import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { childEnv, detectLead, SESSION_ENV_VARS } from "../src/acpx.js";
import { supportedAcpxVersion } from "../src/acpx-version.js";
import { snapshotOf } from "../src/call.js";
import { reserveLogDir } from "../src/callchild.js";
import { chooseCrosscheck, readConfig } from "../src/config.js";
import { repoLogDir, waitMsFromEnv } from "../src/context.js";
import { descendantGroups } from "../src/reviewer.js";
import { readReview, reviewOutcome } from "../src/reviewoutcome.js";
import { compareTrees, snapshotTree } from "../src/worktree.js";
import { CHANGE, defined, fakeLog, type Fixture, makeContext, makeFixture, pathWithout, session, writeConfig } from "./helpers.js";

const config = (...names: string[]) =>
  `human-workflows:\n  crosscheck:\n${names.map((cli) => `    - cli: ${cli}\n`).join("")}`;

function parse(result: { text: string }) {
  return JSON.parse(result.text);
}

async function settled(calls: ReturnType<typeof session>["calls"], id: string) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const result = await calls.get(id);
    if (parse(result).status !== "running") return result;
  }
  return assert.fail(`crosscheck ${id} did not settle`);
}

function launches(fixture: Fixture) {
  return fakeLog(fixture).filter(({ bin }) => bin === "acpx");
}

function byAgent(fixture: Fixture) {
  return Object.fromEntries(launches(fixture).map((launch) => [launch.agent, launch]));
}

test("config accepts named agents and optional data, and rejects each invalid list", () => {
  const fixture = makeFixture({ config: `${config("gemini", "agy")}      model: gemini-4-neon\n      effort: low\n` });
  const read = () => readConfig(fixture.env);
  const result = read();
  assert.ok(result.ok);
  assert.deepEqual(result.crosscheck, [
    { cli: "gemini", effort: "high" },
    { cli: "agy", model: "gemini-4-neon", effort: "low" },
  ]);
  for (const [contents, expected] of [
    ["human-workflows:\n  crosscheck: []\n", /one entry per CLI/],
    [config("codex", "codex"), /more than one entry/],
    [`${config("claude")}      command: shell\n`, /unknown keys: command/],
    ...["-option", "run shell", "Codex", "a_b"].map((name) => [config(name), /must start with a lowercase letter/] as const),
  ] as const) {
    writeConfig(fixture, contents);
    const invalid = read();
    assert.ok(!invalid.ok);
    assert.equal(invalid.reason, "invalid");
    assert.match(invalid.message, expected);
  }
});

test("reviewer selection follows lead and local availability rules", () => {
  const fixture = makeFixture();
  const entries = ["claude", "codex", "agy", "gemini"].map((cli) => ({ cli, effort: "high" }));
  const env = { PATH: pathWithout(fixture, ["agy"]) };
  assert.equal(detectLead("codex-client", { CLAUDECODE: "1" }), "codex");
  assert.equal(detectLead("another", { CLAUDECODE: "1" }), "claude");
  assert.equal(detectLead("another", {}), undefined);
  assert.deepEqual(childEnv({ CLAUDECODE: "1", CLAUDE_CONFIG_DIR: "/fixture" }), { DEFINE_OPENSPEC_CHANGE_CHILD: "1", CLAUDE_CONFIG_DIR: "/fixture" });
  assert.deepEqual(chooseCrosscheck(entries, "codex", env).map(({ cli }) => cli), ["claude", "gemini"]);
  assert.deepEqual(chooseCrosscheck(entries, undefined, env).map(({ cli }) => cli), ["claude", "codex", "gemini"]);
  assert.deepEqual(chooseCrosscheck(entries.slice(0, 3), "codex", { PATH: pathWithout(fixture, ["agy", "claude"]) }), [entries[1]]);
  assert.deepEqual(chooseCrosscheck(entries.slice(0, 3), "codex", { PATH: "" }), []);
});

test("INTEG-1: all launches use the exact acpx command, cwd, environment and stdin", async () => {
  const fixture = makeFixture({
    config: `human-workflows:
  crosscheck:
    - {cli: claude, model: opus, effort: low}
    - {cli: codex, model: gpt-6-astra, effort: medium}
    - {cli: agy, model: gemini-4-neon, effort: high}
    - {cli: gemini, effort: high}
`,
  });
  const prompt = `${"α\n".repeat(60_000)}  `;
  const extraEnv = Object.fromEntries(SESSION_ENV_VARS.filter((key) => key !== "CLAUDECODE").map((key) => [key, "session"]));
  const { calls } = session(makeContext(fixture, { client: "unknown", extraEnv }));
  const result = parse(await calls.start(prompt, join(fixture.repo, "openspec")));
  assert.equal(result.status, "succeeded");
  const captured = byAgent(fixture);
  for (const [agent, args] of Object.entries({
    claude: ["--model", "opus", "claude", "exec", "-f", "-", "--config-option", "effort=low"],
    codex: ["--model", "gpt-6-astra", "codex", "exec", "-f", "-", "--config-option", "reasoning_effort=medium"],
    agy: ["--model", "gemini-4-neon", "--agent", "agy acp", "exec", "-f", "-", "--config-option", "thought_level=high"],
    gemini: ["gemini", "exec", "-f", "-"],
  })) {
    const launch = defined(captured[agent], agent);
    assert.equal(launch.cwd, fixture.repo);
    assert.equal(launch.prompt, prompt);
    assert.deepEqual(launch.args, [
      "--format", "json", "--json-strict", "--suppress-reads", "--approve-all", "--timeout", "3660", "--cwd", fixture.repo, ...args,
    ]);
    assert.equal(launch.env?.DEFINE_OPENSPEC_CHANGE_CHILD, "1");
    assert.ok(SESSION_ENV_VARS.every((key) => launch.env?.[key] === undefined));
  }
  assert.equal(result.reviewers.find(({ cli }: { cli: string }) => cli === "gemini").effort, "not applied (high)");
  assert.equal(parse(await calls.start("portable review", fixture.dir)).working_tree, "unknown");
  for (const launch of launches(fixture).slice(4)) {
    assert.equal(launch.cwd, fixture.dir);
    assert.equal(launch.args[launch.args.indexOf("--cwd") + 1], fixture.dir);
  }
});

test("INTEG-2: non-lead reviewers overlap and a slow result can be polled", async () => {
  const fixture = makeFixture({ config: config("claude", "codex", "agy") });
  const { calls } = session(makeContext(fixture, {
    waitMs: 10,
    extraEnv: { FAKE_REVIEWERS: JSON.stringify({ agy: { delay: 350 }, codex: { delay: 350 } }) },
  }));
  const pending = parse(await calls.start("review"));
  assert.equal(pending.status, "running");
  assert.match(pending.crosscheck_id, /^cc-[a-f\d]{8}$/);
  assert.match(pending.next, /get_crosscheck/);
  assert.equal(typeof pending.elapsed, "string");
  assert.equal(pending.working_tree, undefined);
  assert.equal(pending.changed_paths, undefined);
  assert.equal(pending.reviewers.length, 2);
  for (const reviewer of pending.reviewers) {
    assert.equal(reviewer.status, "running");
    assert.equal(typeof reviewer.elapsed, "string");
    assert.equal(reviewer.response, undefined);
  }
  const end = parse(await settled(calls, pending.crosscheck_id));
  assert.equal(end.status, "succeeded");
  assert.deepEqual(end.reviewers.map(({ cli, model, effort }: { cli: string; model: string; effort: string }) => [cli, model, effort]), [
    ["codex", "default", "high"], ["agy", "default", "high"],
  ]);
  const starts = launches(fixture).map(({ started }) => defined(started));
  const ends = fakeLog(fixture).filter(({ bin }) => bin === "review-end").map(({ ended }) => defined(ended));
  assert.ok(Math.max(...starts) < Math.min(...ends));
});

test("INTEG-2: selection is enforced for fallback, unknown leads and missing agy", async () => {
  const fixture = makeFixture({ config: config("claude", "codex", "agy") });
  const cases = [
    { client: "claude", missing: ["codex", "agy"], expected: ["claude"] },
    { client: "unknown", missing: [], expected: ["agy", "claude", "codex"] },
    { client: "claude", missing: ["agy"], expected: ["codex"] },
  ];
  for (const { client, missing, expected } of cases) {
    const context = makeContext(fixture, { client, extraEnv: { PATH: pathWithout(fixture, missing) } });
    const offset = launches(fixture).length;
    const result = await session(context).calls.start("review");
    assert.equal(parse(result).status, "succeeded");
    assert.deepEqual(launches(fixture).slice(offset).map(({ agent }) => agent).sort(), expected);
  }
});

test("INTEG-2: overlapping starts and steps are refused before they start work", async () => {
  const fixture = makeFixture();
  const { calls, next } = session(makeContext(fixture, {
    waitMs: 10, extraEnv: { FAKE_REVIEWERS: JSON.stringify({ codex: { delay: 180 } }) },
  }));
  const started = calls.start("first");
  const empty = await calls.start(" \n");
  assert.equal(parse(empty).error.code, "invalid_request");
  const overlap = parse(await calls.start("second"));
  assert.equal(overlap.error.code, "crosscheck_in_progress");
  const startingStep = await next({ change_name: CHANGE, start: true });
  assert.equal(startingStep.isError, true);
  assert.ok(startingStep.text.includes(overlap.crosscheck_id));
  const pending = parse(await started);
  assert.equal(pending.crosscheck_id, overlap.crosscheck_id);
  const runningStep = await next({ change_name: CHANGE, start: true });
  assert.equal(runningStep.isError, true);
  assert.ok(runningStep.text.includes(pending.crosscheck_id));
  assert.equal(parse(await settled(calls, pending.crosscheck_id)).status, "succeeded");
  const step = next({ change_name: CHANGE, start: true });
  assert.equal(parse(await calls.start("third")).error.code, "step_in_progress");
  assert.equal((await step).isError, undefined);
  assert.equal(launches(fixture).length, 1);
  assert.equal(parse(await calls.get("missing")).error.code, "unknown_crosscheck");
  assert.equal(parse(await calls.cancel("missing")).error.code, "unknown_crosscheck");
});

test("INTEG-2: private logs are separated across managers", async () => {
  const fixture = makeFixture();
  const context = makeContext(fixture);
  const first = session(context).calls.start("first review");
  const second = session(context).calls.start("second review");
  const results = (await Promise.all([first, second])).map(parse);
  const ids = results.map(({ crosscheck_id }) => crosscheck_id);
  assert.notEqual(ids[0], ids[1]);
  for (const id of ids) {
    const base = repoLogDir(context, fixture.repo);
    const batch = join(base, id);
    const reviewer = join(batch, "1-codex");
    for (const dir of [context.logBase, base, batch, reviewer]) assert.equal(statSync(dir).mode & 0o777, 0o700);
    assert.deepEqual(readdirSync(reviewer).sort(), ["command.json", "events.ndjson", "prompt.txt", "response.txt", "stderr.txt"]);
    for (const file of readdirSync(reviewer)) assert.equal(statSync(join(reviewer, file)).mode & 0o777, 0o600);
  }
  assert.equal(fixture.events().filter(({ event }) => event === "crosscheck_end").length, 2);
});

test("an existing log folder forces a new crosscheck ID without altering prior logs", () => {
  const fixture = makeFixture();
  const context = makeContext(fixture);
  const taken = "cc-01234567";
  const occupied = join(repoLogDir(context, fixture.repo), taken);
  mkdirSync(occupied, { recursive: true });
  const previousLog = join(occupied, "prompt.txt");
  writeFileSync(previousLog, "prior review");
  const reserved = reserveLogDir(context, fixture.repo, taken);
  assert.notEqual(reserved.id, taken);
  assert.equal(reserved.dir, join(repoLogDir(context, fixture.repo), reserved.id));
  assert.equal(statSync(reserved.dir).mode & 0o777, 0o700);
  assert.equal(readFileSync(previousLog, "utf8"), "prior review");
});

test("INTEG-2: a temp path inside the working tree uses the external private log base", async () => {
  const fixture = makeFixture();
  const alias = join(fixture.dir, "repo-alias");
  symlinkSync(fixture.repo, alias);
  const context = makeContext(fixture, { logBase: join(alias, "temp-logs") });
  const { calls } = session(context);
  const result = parse(await calls.start("review"));
  assert.equal(result.status, "succeeded");
  assert.equal(result.working_tree, "unchanged");
  assert.equal(fixture.git("status", "--porcelain"), "");
  const directory = repoLogDir(context, fixture.repo);
  assert.equal(statSync(join(directory, result.crosscheck_id)).mode & 0o777, 0o700);
  rmSync(directory, { recursive: true });
});

test("the wait override and minimum acpx version are checked", () => {
  assert.equal(waitMsFromEnv({}), 50_000);
  assert.equal(waitMsFromEnv({ DEFINE_OPENSPEC_CHANGE_WAIT_SECONDS: "0.1" }), 100);
  for (const version of ["0.23.0", "0.23.0+build", "0.100.0", "1.0.0"]) assert.ok(supportedAcpxVersion(version), version);
  for (const version of ["0.22.9", "0.23.0-rc.1", "unknown", "0.023.0"]) assert.ok(!supportedAcpxVersion(version), version);
});

test("result formatting omits interim answers and sets MCP error only for no successes", () => {
  const now = new Date("2026-11-27T01:01:05Z");
  const startedAt = new Date("2026-11-27T01:00:00Z");
  const batch = { id: "cc-12345678", startedAt };
  const success = {
    entry: { cli: "gemini", effort: "high" },
    startedAt, endedAt: now, outcome: { status: "succeeded", response: "answer" } as const,
  };
  const failure = {
    entry: { cli: "codex", model: "model-id", effort: "low" },
    startedAt, endedAt: now, outcome: { status: "failed", code: "empty_answer", error: "empty" } as const,
  };
  const running = parse(snapshotOf({ ...batch, status: "running", reviewers: [success, failure] }, now));
  assert.deepEqual(running.reviewers, [
    { cli: "gemini", model: "default", effort: "not applied (high)", status: "succeeded", elapsed: "1m 5s" },
    { cli: "codex", model: "model-id", effort: "low", status: "failed", elapsed: "1m 5s" },
  ]);
  assert.equal(running.working_tree, undefined);
  const mixed = snapshotOf({
    ...batch, status: "failed", reviewers: [success, failure],
    tree: { working_tree: "changed", changed_paths: ["changed.md"] },
  }, now);
  assert.equal(mixed.isError, false);
  assert.equal(parse(mixed).reviewers[0].response, "answer");
  assert.deepEqual(parse(mixed).changed_paths, ["changed.md"]);
  assert.equal(snapshotOf({ ...batch, status: "failed", reviewers: [failure] }, now).isError, true);
});

test("review parser matches the prompt response, skips malformed lines, and falls back to any stop reason", async () => {
  const { dir } = makeFixture();
  const chunk = (text: string) => ({
    method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } },
  });
  const prompt = { id: 7, method: "session/prompt" };
  const response = { id: 7, result: { stopReason: "end_turn" } };
  const other = { id: 8, result: { stopReason: "max_tokens" } };
  const events = join(dir, "events.ndjson");
  writeFileSync(join(dir, "stderr.txt"), `${"padding ".repeat(500)}error tail`);
  const log = [
    prompt, chunk("first"), chunk(" and "), chunk("last"),
    { id: 6, error: { message: "recovered error", data: { details: "recovered detail" } } },
    response, other, { id: 9, error: { message: "fallback error" } },
  ];
  writeFileSync(events, `not json\n${log.map((event) => JSON.stringify(event)).join("\n")}`);
  const matched = await readReview(dir);
  assert.equal(matched.answer, "first and last");
  assert.equal(matched.stop, "end_turn");
  assert.doesNotMatch(matched.error, /recovered/);
  assert.match(matched.error, /^fallback error\n\.\.\..*error tail$/);
  writeFileSync(events, JSON.stringify(other));
  assert.equal((await readReview(dir)).stop, "max_tokens");
  assert.equal(reviewOutcome({ code: 3, stopped: "canceled" }).status, "canceled");
  assert.deepEqual(reviewOutcome({ code: 0, stopped: "timeout" }), {
    status: "failed", code: "timeout", error: "Crosscheck reached its time limit.",
  });
});

test("INTEG-2: acpx failures and successful answers survive together", async () => {
  const agents = {
    delayed: { delay: 200, answer: "final review", beforeTool: true, trailingUpdate: true },
    unknown: { code: 1, error: "agent is unknown" },
    "bad-model": { code: 1, error: "model is not offered" },
    "bad-effort": { code: 1, error: "unsupported effort" },
    "disabled-exec": { code: 2, error: "exec disabled" },
    timedout: { code: 3 },
    blank: { answer: "" },
    stopped: { stop: "max_tokens" },
    incomplete: { stop: null },
    lastcall: { answer: "before last call", trailingCall: true },
    long: { length: 200_100 },
  };
  const fixture = makeFixture({ config: config(...Object.keys(agents)) });
  const { calls } = session(makeContext(fixture, { extraEnv: { FAKE_REVIEWERS: JSON.stringify(agents) } }));
  const output = await calls.start("review");
  const result = parse(output);
  assert.equal(output.isError, false);
  assert.equal(result.status, "failed");
  assert.equal(result.reviewers.length, Object.keys(agents).length);
  const reviews = Object.fromEntries(result.reviewers.map((review: { cli: string }) => [review.cli, review]));
  for (const agent of ["unknown", "bad-model", "bad-effort", "disabled-exec"] as const) {
    assert.equal(reviews[agent].status, "failed");
    assert.equal(reviews[agent].code, "execution_failed");
    assert.ok(reviews[agent].error.includes(agents[agent].error));
    assert.match(reviews[agent].error, /adapter stderr/);
  }
  assert.equal(reviews.timedout.code, "timeout");
  assert.equal(reviews.blank.code, "empty_answer");
  assert.equal(reviews.stopped.code, "stopped");
  assert.match(reviews.stopped.error, /max_tokens/);
  assert.equal(reviews.incomplete.code, "execution_failed");
  assert.equal(reviews.delayed.status, "succeeded");
  assert.equal(reviews.delayed.response, "final review");
  assert.equal(reviews.lastcall.response, "before last call");
  assert.equal(reviews.long.response.split("\n")[0].length, 200_000);
  assert.match(reviews.long.response, /truncated/);
});

test("INTEG-2: a spawn failure becomes launch_failed and sets the MCP error flag", async () => {
  const fixture = makeFixture();
  const { calls } = session(makeContext(fixture));
  assert.equal(await calls.acpx.refusal(fixture.repo, fixture.env), undefined);
  rmSync(join(fixture.dir, "bin", "acpx"));
  const result = await calls.start("review");
  assert.equal(result.isError, true);
  const record = parse(result);
  assert.equal(record.status, "failed");
  assert.equal(record.reviewers[0].status, "failed");
  assert.equal(record.reviewers[0].code, "launch_failed");
  assert.match(record.reviewers[0].error, /acpx.*ENOENT/);
});

async function ready(fixture: Fixture, expected: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const launch = byAgent(fixture)[expected];
    if (launch?.pids) return launch.pids;
    await delay(10);
  }
  return assert.fail(`reviewer ${expected} never started`);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    // Linux containers can leave an exited orphan as a zombie if PID 1 is not a reaper.
    return !execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().startsWith("Z");
  } catch {
    return false;
  }
}

async function assertStopped(pids: number[]) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!pids.some(alive)) return;
    await delay(10);
  }
  assert.fail(`still alive: ${pids.filter(alive).join(", ")}`);
}

async function waitForFastReviewer(calls: ReturnType<typeof session>["calls"], id: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = parse(await calls.get(id));
    if (snapshot.reviewers.find(({ cli }: { cli: string }) => cli === "fast").status === "succeeded") return;
  }
  assert.fail("fast reviewer did not finish");
}

for (const { action, ignoreTerm } of [
  { action: "cancel", ignoreTerm: true }, { action: "cancel", ignoreTerm: false },
  { action: "timeout", ignoreTerm: true }, { action: "shutdown", ignoreTerm: false },
]) {
  test(`INTEG-3: ${action} stops process groups (acpx ignores SIGTERM: ${ignoreTerm})`, async () => {
    const fixture = makeFixture({ config: config("claude", "slow", "fast") });
    const { calls } = session(makeContext(fixture, {
      waitMs: 20, maxCallMs: action === "timeout" ? 950 : 60_000, killGraceMs: 100,
      extraEnv: { FAKE_REVIEWERS: JSON.stringify({ slow: { ignoreTerm, descendants: true, delay: 8_000 } }) },
    }));
    const pending = parse(await calls.start("review"));
    const pids = await ready(fixture, "slow");
    assert.equal(pids.length, 3);
    await waitForFastReviewer(calls, pending.crosscheck_id);
    if (action === "cancel") {
      await calls.cancel(pending.crosscheck_id);
    } else if (action === "shutdown") {
      await calls.killAll(100);
    }
    const result = parse(await settled(calls, pending.crosscheck_id));
    assert.equal(result.status, action === "timeout" ? "failed" : "canceled");
    const slow = result.reviewers.find(({ cli }: { cli: string }) => cli === "slow");
    assert.equal(slow.status, action === "timeout" ? "failed" : "canceled");
    assert.equal(slow.code, action === "timeout" ? "timeout" : undefined);
    assert.equal(result.reviewers.find(({ cli }: { cli: string }) => cli === "fast").response, "fast review");
    await assertStopped(pids);
  });
}

test("descendant group selection excludes the server group even when a descendant joins it", () => {
  const groups = descendantGroups(200, [
    { pid: 100, parent: 1, group: 90 },
    { pid: 200, parent: 100, group: 200 },
    { pid: 201, parent: 200, group: 90 },
    { pid: 202, parent: 201, group: 202 },
    { pid: 300, parent: 100, group: 300 },
  ], 100);
  assert.deepEqual(groups, [200, 202]);
});

test("INTEG-3: cancellation finds a detached child created after SIGTERM", async (t) => {
  const fixture = makeFixture();
  const { calls } = session(makeContext(fixture, {
    waitMs: 20, killGraceMs: 500,
    extraEnv: { FAKE_REVIEWERS: JSON.stringify({ codex: { lateDescendant: true, delay: 8_000 } }) },
  }));
  const pending = parse(await calls.start("review"));
  const parent = await ready(fixture, "codex");
  const lateChild = () => fakeLog(fixture).find(({ bin }) => bin === "late-descendant")?.pids ?? [];
  t.after(() => {
    for (const pid of [...parent, ...lateChild()].filter(alive)) process.kill(pid, "SIGKILL");
  });
  await calls.cancel(pending.crosscheck_id);
  assert.equal(parse(await settled(calls, pending.crosscheck_id)).status, "canceled");
  assert.equal(lateChild().length, 1);
  await assertStopped([...parent, ...lateChild()]);
});

const staged = (fixture: Fixture) => {
  fixture.write("README.md", "staged\n");
  fixture.git("add", "README.md");
  fixture.write("README.md", "unstaged\n");
};

test("INTEG-4: real git snapshots report exact changed paths or unknown", async () => {
  const cases: Array<[string[], (fixture: Fixture) => void, ((fixture: Fixture) => void)?]> = [
    [["README.md"], (f) => f.write("README.md", "edited")],
    [["new file\nname"], (f) => f.write("new file\nname", "added")],
    [["README.md"], (f) => rmSync(join(f.repo, "README.md"))],
    [["README.md"], (f) => { f.write("README.md", "indexed"); f.git("add", "README.md"); }],
    [["link"], (f) => { rmSync(join(f.repo, "link")); symlinkSync("changed", join(f.repo, "link")); }, (f) => symlinkSync("old", join(f.repo, "link"))],
    [["README.md", "new"], (f) => f.git("mv", "README.md", "new")],
    [["HEAD", "README.md"], (f) => { f.write("README.md", "commit"); f.git("commit", "-qam", "next"); }],
    [[], () => {}],
    [["README.md"], (f) => f.write("README.md", "edited twice"), (f) => f.write("README.md", "edited")],
    [["README.md"], (f) => chmodSync(join(f.repo, "README.md"), 0o755), (f) => f.write("README.md", "edited")],
    [["README.md"], (f) => { f.write("README.md", "staged again"); f.git("add", "README.md"); f.write("README.md", "unstaged\n"); }, staged],
  ];
  for (const [changed_paths, mutate, prepare] of cases) {
    const fixture = makeFixture();
    const options = { cwd: fixture.repo, env: fixture.env };
    prepare?.(fixture);
    const before = await snapshotTree(options);
    mutate(fixture);
    const after = await snapshotTree(options);
    const result = await compareTrees(before, after, options);
    assert.deepEqual(result, changed_paths.length > 0 ? { working_tree: "changed", changed_paths } : { working_tree: "unchanged" });
  }
  const unavailable = makeFixture();
  const outside = { cwd: unavailable.dir, env: unavailable.env };
  const inside = { cwd: unavailable.repo, env: unavailable.env };
  const before = await snapshotTree(inside);
  rmSync(join(unavailable.repo, ".git"), { recursive: true });
  const failed = await snapshotTree(inside);
  assert.ok(before);
  assert.equal(failed, undefined);
  assert.equal(await snapshotTree(outside), undefined);
  assert.deepEqual(await compareTrees(before, failed, inside), { working_tree: "unknown" });
  assert.deepEqual(await compareTrees(failed, before, inside), { working_tree: "unknown" });
  const fixture = makeFixture();
  const { calls } = session(makeContext(fixture, {
    extraEnv: { FAKE_REVIEWERS: JSON.stringify({ codex: { write: "reviewer-written" } }) },
  }));
  const result = parse(await calls.start("review"));
  assert.equal(result.working_tree, "changed");
  assert.deepEqual(result.changed_paths, ["reviewer-written"]);
});
