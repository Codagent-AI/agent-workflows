import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { STATE_FILE } from "../src/state.js";
import { CHANGE, fakeLog, makeContext, makeFixture, session, writeArtifacts } from "./helpers.js";

const STATE = `openspec/changes/${CHANGE}/${STATE_FILE}`;

test("start creates the change and returns the proposal step", async () => {
  const fixture = makeFixture();
  const { next } = session(makeContext(fixture));
  const result = await next({ change_name: CHANGE, start: true });

  assert.equal(result.isError, undefined);
  assert.match(result.text, /^Created OpenSpec change "add-reading-time" at `openspec\/changes\/add-reading-time\/`\./);
  assert.match(result.text, /You are running in the "define-openspec-change" workflow: Interactively define/);
  assert.match(result.text, /The current step is "proposal" \(step 1 of 5\)\./);
  assert.match(result.text, /Before doing anything else, announce that you are starting this step\./);
  assert.match(result.text, /You MUST use the define-openspec-change:propose skill/);
  assert.doesNotMatch(result.text, /\{\{/);
  assert.match(result.text, /call the `next_step` tool with change_name "add-reading-time"/);

  assert.deepEqual(fakeLog(fixture).map((entry) => entry.args.join(" ")), [`new change ${CHANGE}`]);
  const state = JSON.parse(fixture.read(STATE));
  assert.equal(state.status, "in_progress");
  assert.equal(state.current_step, "proposal");
  assert.equal(state.starts.length, 1);
  assert.equal(state.starts[0].mode, "new");
  assert.equal(state.starts[0].lead, "claude");
});

test("the step prompt names the review skill by absolute path inside the plugin", async () => {
  const fixture = makeFixture();
  const context = makeContext(fixture);
  const { next } = session(context);
  const result = await next({ change_name: CHANGE, start: true });
  assert.ok(result.text.includes(`${context.pluginRoot}/skills/proposal-review/SKILL.md`));
});

test("invalid change names are refused before anything is created", async () => {
  const fixture = makeFixture();
  const { next } = session(makeContext(fixture));
  for (const name of ["Add-Thing", "-leading", "has space", "under_score", "dot.name"]) {
    const result = await next({ change_name: name, start: true });
    assert.equal(result.isError, true, name);
    assert.match(result.text, /^Refused: change_name must use lowercase letters, digits, and hyphens/);
  }
  const missing = await next({ start: true });
  assert.equal(missing.isError, true);
  assert.match(missing.text, /start needs a change_name/);
  assert.deepEqual(fakeLog(fixture), []);
});

test("an existing change that define did not start is refused", async () => {
  const fixture = makeFixture();
  fixture.write(`openspec/changes/${CHANGE}/proposal.md`, "existing\n");
  const { next } = session(makeContext(fixture));

  const start = await next({ change_name: CHANGE, start: true });
  assert.equal(start.isError, true);
  assert.match(start.text, /already exists at .*define-openspec-change did not start it/);
  const advance = await next({ change_name: CHANGE });
  assert.equal(advance.isError, true);
  assert.match(advance.text, /was not started with define-openspec-change/);
  assert.deepEqual(fakeLog(fixture), []);
});

test("an early next_step is refused and names what is missing", async () => {
  const fixture = makeFixture();
  const { next } = session(makeContext(fixture));
  await next({ change_name: CHANGE, start: true });

  const early = await next({ change_name: CHANGE });
  assert.equal(early.isError, true);
  assert.equal(
    early.text,
    `Refused: step "proposal" of OpenSpec change "${CHANGE}" is not complete. Missing: a non-empty openspec/changes/${CHANGE}/proposal.md. Finish the step, then call next_step again.`,
  );

  fixture.write(`openspec/changes/${CHANGE}/proposal.md`, "");
  const empty = await next({ change_name: CHANGE });
  assert.equal(empty.isError, true, "an empty proposal does not count");

  writeArtifacts(fixture, CHANGE, "proposal");
  const specs = await next({ change_name: CHANGE });
  assert.equal(specs.isError, undefined);
  assert.match(specs.text, /^Continuing to step "specs" \(step 2 of 5\)\./);

  fixture.write(`openspec/changes/${CHANGE}/specs/notes.md`, "not a capability spec\n");
  const looseSpec = await next({ change_name: CHANGE });
  assert.equal(looseSpec.isError, true);
  assert.match(looseSpec.text, /at least one non-empty openspec\/changes\/add-reading-time\/specs\/<capability>\/spec\.md/);
  assert.equal(JSON.parse(fixture.read(STATE)).current_step, "specs");
});

test("steps advance in Runner's order and each prompt arrives once", async () => {
  const fixture = makeFixture();
  const { next } = session(makeContext(fixture));
  const seen: string[] = [];
  const first = await next({ change_name: CHANGE, start: true });
  seen.push(first.text.match(/The current step is "([^"]+)"/)?.[1] ?? "");
  writeArtifacts(fixture);
  for (let i = 0; i < 4; i++) {
    const result = await next({ change_name: CHANGE });
    assert.equal(result.isError, undefined, result.text);
    seen.push(result.text.match(/^Continuing to step "([^"]+)"/)?.[1] ?? "");
  }
  assert.deepEqual(seen, ["proposal", "specs", "design", "test-plan", "approach-review"]);

  const state = JSON.parse(fixture.read(STATE));
  assert.equal(state.current_step, "approach-review");
  for (const step of ["proposal", "specs", "design", "test-plan"]) {
    assert.ok(state.steps[step].completed_at, step);
  }
  assert.equal(state.steps["approach-review"].completed_at, undefined);
});

test("the last step's prompt says next_step validates and commits", async () => {
  const fixture = makeFixture();
  const { next } = session(makeContext(fixture));
  await next({ change_name: CHANGE, start: true });
  writeArtifacts(fixture);
  let last = { text: "" };
  for (let i = 0; i < 4; i++) last = await next({ change_name: CHANGE });
  assert.match(last.text, /This is the last step: that call validates the change and commits its documents\./);
  assert.match(last.text, /review-approach\/SKILL\.md/);
});

test("a new session resumes the current step from the state file without advancing", async () => {
  const fixture = makeFixture();
  const first = session(makeContext(fixture));
  await first.next({ change_name: CHANGE, start: true });
  writeArtifacts(fixture, CHANGE, "specs");
  await first.next({ change_name: CHANGE });
  await first.next({ change_name: CHANGE });

  const second = session(makeContext(fixture, { client: "codex-mcp-client" }));
  const resumed = await second.next({ change_name: CHANGE, start: true });
  assert.equal(resumed.isError, undefined);
  assert.match(resumed.text, /Resuming step: "design" \(step 3 of 5\)\. If you already started on this step, resume from where you left off\./);
  assert.match(resumed.text, /Completed steps: proposal, specs\./);
  assert.match(resumed.text, /define-openspec-change:design skill/);

  const state = JSON.parse(fixture.read(STATE));
  assert.equal(state.current_step, "design");
  assert.deepEqual(
    state.starts.map((start: { mode: string; lead: string; step: string }) => [start.mode, start.lead, start.step]),
    [
      ["new", "claude", "proposal"],
      ["resume", "codex", "design"],
    ],
  );

  const early = await second.next({ change_name: CHANGE });
  assert.equal(early.isError, true, "design.md is not written yet");
});

test("change_name can be left out when exactly one define is in progress", async () => {
  const fixture = makeFixture();
  const { next } = session(makeContext(fixture));
  const none = await next({});
  assert.equal(none.isError, true);
  assert.match(none.text, /no define is in progress/);

  await next({ change_name: CHANGE, start: true });
  writeArtifacts(fixture, CHANGE, "proposal");
  const result = await next({});
  assert.match(result.text, /^Continuing to step "specs"/);

  await next({ change_name: "second-change", start: true });
  const ambiguous = await next({});
  assert.equal(ambiguous.isError, true);
  assert.match(ambiguous.text, /more than one define is in progress \(add-reading-time, second-change\)/);
});

test("a completed define refuses start and says it is finished", async () => {
  const fixture = makeFixture();
  const { next } = session(makeContext(fixture));
  await next({ change_name: CHANGE, start: true });
  writeArtifacts(fixture);
  for (let i = 0; i < 5; i++) await next({ change_name: CHANGE });
  assert.equal(JSON.parse(fixture.read(STATE)).status, "complete");

  const again = await next({ change_name: CHANGE, start: true });
  assert.equal(again.isError, true);
  assert.match(again.text, /was already defined/);
  const advance = await next({ change_name: CHANGE });
  assert.equal(advance.isError, undefined);
  assert.match(advance.text, /is already defined .* do not call next_step again/);
});

test("a corrupt state file is refused, not overwritten", async () => {
  const fixture = makeFixture();
  fixture.write(STATE, "{not json");
  const { next } = session(makeContext(fixture));
  const result = await next({ change_name: CHANGE, start: true });
  assert.equal(result.isError, true);
  assert.match(result.text, /is not valid JSON/);
  assert.equal(fixture.read(STATE), "{not json");
});

test("next_step outside a git repository is refused", async () => {
  const fixture = makeFixture();
  const { next } = session(makeContext(fixture, { cwd: fixture.dir }));
  const result = await next({ change_name: CHANGE, start: true });
  assert.equal(result.isError, true);
  assert.match(result.text, /must run inside a git repository/);
  assert.equal(existsSync(join(fixture.dir, "openspec")), false);
});

test("the session directory is read from Codex tool-call metadata", async () => {
  const { sessionCwdFromMeta } = await import("../src/session.js");
  assert.equal(sessionCwdFromMeta(undefined), undefined);
  assert.equal(sessionCwdFromMeta({ progressToken: 1 }), undefined);
  assert.equal(sessionCwdFromMeta({ "codex/sandbox-state-meta": { sandboxCwd: "file:///tmp/some%20repo" } }), "/tmp/some repo");
  assert.equal(sessionCwdFromMeta({ "codex/sandbox-state": { sandboxCwd: "/tmp/plain" } }), "/tmp/plain");
  assert.equal(sessionCwdFromMeta({ "x-codex-turn-metadata": { workspaces: { "/tmp/ws": { has_changes: false } } } }), "/tmp/ws");
  assert.equal(sessionCwdFromMeta({ "x-codex-turn-metadata": { workspaces: { "/a": {}, "/b": {} } } }), undefined);
});
