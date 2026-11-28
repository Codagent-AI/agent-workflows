import assert from "node:assert/strict";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { acpxProbeRefusal } from "../src/acpx-version.js";
import { settledStatus } from "../src/call.js";
import { newState, STATE_FILE } from "../src/state.js";
import { loadWorkflow, parseWorkflow, renderStep, stepIds, WorkflowError } from "../src/steps.js";
import {
  CHANGE,
  DEFAULT_CONFIG,
  fakeLog,
  makeContext,
  makeFixture,
  PLUGIN_ROOT,
  pathWithout,
  session,
  writeArtifacts,
  writeConfig,
} from "./helpers.js";

const STATE = `openspec/changes/${CHANGE}/${STATE_FILE}`;

test("start creates the change and returns the proposal step", async () => {
  const fixture = makeFixture();
  const { next } = session(makeContext(fixture));
  const result = await next({ change_name: CHANGE, start: true });

  assert.equal(result.isError, undefined);
  assert.match(result.text, /^Created OpenSpec change "add-reading-time" at `openspec\/changes\/add-reading-time\/`\./);
  assert.match(result.text, /You are running in the "define-openspec-change" workflow: /);
  assert.match(result.text, /The current step is "proposal" \(step 1 of 5\)\./);
  assert.match(result.text, /call the `next_step` tool with change_name "add-reading-time"/);

  assert.deepEqual(fakeLog(fixture).map((entry) => entry.args.join(" ")), [`new change ${CHANGE}`]);
  const state = JSON.parse(fixture.read(STATE));
  assert.equal(state.status, "in_progress");
  assert.equal(state.current_step, "proposal");
  assert.equal(state.starts.length, 1);
  assert.equal(state.starts[0].mode, "new");
  assert.equal(state.starts[0].lead, "claude");
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
  assert.deepEqual(fakeLog(fixture).filter(({ bin }) => bin === "openspec"), []);
});

test("start is refused until the crosscheck is configured, and nothing is created", async () => {
  const fixture = makeFixture({ config: null });
  const { next } = session(makeContext(fixture));
  const refused = await next({ change_name: CHANGE, start: true });
  assert.equal(refused.isError, true);
  assert.match(refused.text, /^Refused: There is no ~\/\.agent-workflows\/config\.yaml/);
  assert.equal(existsSync(join(fixture.repo, "openspec", "changes", CHANGE)), false);
  assert.deepEqual(fakeLog(fixture), []);

  writeConfig(fixture, DEFAULT_CONFIG);
  const started = await next({ change_name: CHANGE, start: true });
  assert.equal(started.isError, undefined);
});

test("start is refused when no configured CLI is installed", async () => {
  const fixture = makeFixture({ config: "human-workflows:\n  crosscheck:\n    - cli: codex\n" });
  const context = makeContext(fixture);
  const { next } = session({ ...context, env: { ...context.env, PATH: pathWithout(fixture, ["codex"]) } });
  const refused = await next({ change_name: CHANGE, start: true });
  assert.equal(refused.isError, true);
  assert.match(refused.text, /No crosscheck reviewer can run.*codex/);
});

test("an early next_step is refused and names what is missing", async () => {
  const fixture = makeFixture();
  const { next } = session(makeContext(fixture));
  await next({ change_name: CHANGE, start: true });

  const early = await next({ change_name: CHANGE });
  assert.equal(early.isError, true);
  assert.ok(
    early.text.startsWith(
      `Refused: step "proposal" of OpenSpec change "${CHANGE}" is not complete. Missing: a non-empty openspec/changes/${CHANGE}/proposal.md.`,
    ),
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

test("an artifact OpenSpec reports no status for is not done", async () => {
  const fixture = makeFixture();
  const { next } = session(makeContext(fixture, { extraEnv: { FAKE_OPENSPEC_STATUS_OMIT: "proposal" } }));
  await next({ change_name: CHANGE, start: true });
  writeArtifacts(fixture, CHANGE, "proposal");

  const result = await next({ change_name: CHANGE });
  assert.equal(result.isError, true);
  assert.match(result.text, /Missing: OpenSpec to report the proposal artifact as done \(it reports no status for it\)/);
  assert.equal(JSON.parse(fixture.read(STATE)).current_step, "proposal");
});

test("steps advance in workflow order and save completion times", async () => {
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
  assert.match(resumed.text, /Resuming step: "design" \(step 3 of 5\)\./);
  assert.match(resumed.text, /Completed steps: proposal, specs\./);

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
  assert.match(advance.text, /is already defined/);
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
  assert.equal(sessionCwdFromMeta({ "codex/sandbox-state-meta": { sandboxCwd: "/tmp/plain" } }), "/tmp/plain");
  assert.equal(sessionCwdFromMeta({ "codex/sandbox-state-meta": { sandboxCwd: "" } }), undefined);
  assert.equal(sessionCwdFromMeta({ "x-codex-turn-metadata": { workspaces: { "/tmp/ws": { has_changes: false } } } }), undefined);
});

const VALID = `name: demo
description: A demo.
steps:
  - id: one
    tools: [call_agent]
    prompt: |
      Do {{change_name}} with {{review:sample.md}}.
  - id: two
    prompt: Finish.
`;

function malformed(text: string): string {
  try {
    parseWorkflow(text);
  } catch (error) {
    assert.ok(error instanceof WorkflowError);
    return error.message;
  }
  return assert.fail("expected the workflow to be rejected");
}

test("a malformed workflow.yaml is rejected with a clear message", () => {
  const workflow = parseWorkflow(VALID);
  assert.deepEqual(stepIds(workflow), ["one", "two"]);
  assert.deepEqual(Object.keys(workflow.steps[0] ?? {}), ["id", "prompt"]);

  assert.match(malformed("steps: ["), /not valid YAML/);
  assert.match(malformed("- just a list"), /must be a mapping/);
  assert.match(malformed(VALID.replace("name: demo\n", "")), /name: needs a name/);
  assert.match(malformed(VALID.replace("description: A demo.\n", "")), /description: needs a description/);
  assert.match(malformed("name: demo\ndescription: d\nsteps: []\n"), /steps: needs at least one step/);
  assert.match(malformed(VALID.replace("id: two", "id: one")), /steps\[1\]\.id: step id "one" is used twice/);
  assert.match(malformed(VALID.replace("    prompt: Finish.\n", "")), /steps\[1\]\.prompt: needs a prompt/);
  assert.match(malformed(VALID.replace("{{review:sample.md}}", "{{unknown}}")), /has an unknown placeholder \{\{unknown\}\}/);
  for (const placeholder of ["{{reviews_dir}}", "{{review:../sample.md}}", "{{review:sub\\sample.md}}", "{{review:sample.txt}}"]) {
    assert.ok(malformed(VALID.replace("{{review:sample.md}}", placeholder)).includes(placeholder));
  }
  assert.match(malformed(`${VALID}shared_prompts:\n  call_agent: Legacy.\n`), /shared_prompts: .*call_agent/);
  assert.match(malformed(`${VALID}shared_prompts:\n  every-step: Typo.\n`), /shared_prompts: .*every-step/);
  assert.match(malformed(`${VALID}shared_prompts:\n  every_step: Use {{unknown}}.\n`), /shared_prompts\.every_step: has an unknown placeholder/);
});

test("INTEG-7: review files are loaded at startup and rendered in order with shared text", async () => {
  const fixture = makeFixture();
  const root = join(fixture.dir, "plugin");
  const reviews = join(root, "reviews");
  mkdirSync(reviews, { recursive: true });
  const workflowFile = join(root, "workflow.yaml");
  const reviewFile = join(reviews, "sample.md");
  assert.throws(() => loadWorkflow(root), /workflow\.yaml/);
  const source = `${VALID}shared_prompts:\n  every_step: Shared demo text.\n`;
  writeFileSync(workflowFile, source);
  assert.throws(() => loadWorkflow(root), /workflow\.yaml.*sample\.md/);
  const outside = join(fixture.dir, "outside.md");
  writeFileSync(outside, "outside");
  symlinkSync(outside, join(reviews, "link.md"));
  writeFileSync(workflowFile, source.replace("sample.md", "link.md"));
  assert.throws(() => loadWorkflow(root), /workflow\.yaml.*inside the reviews folder/);
  writeFileSync(workflowFile, source);
  writeFileSync(reviewFile, "First line.\nSecond line.\n");
  const workflow = loadWorkflow(root);
  writeFileSync(reviewFile, "Changed after startup.");
  const { next } = session(makeContext(fixture, { workflow }));
  const result = await next({ start: true, change_name: CHANGE });
  assert.equal(result.isError, undefined);
  assert.match(result.text, /Do add-reading-time with First line\.\nSecond line\.\n\.\n\nShared demo text\.\n\nWhen you or the user determine/);
  assert.equal(result.text.match(/Shared demo text/g)?.length, 1);
  const other = renderStep({ workflow, changeName: CHANGE, step: "two", mode: "continue", completed: [] });
  assert.match(other, /Finish\.\n\nShared demo text\./);
  assert.doesNotThrow(() => loadWorkflow(PLUGIN_ROOT));
});

test("new state starts with only the first step, an empty batch history and a lead record", () => {
  const at = "2026-11-27T00:00:00Z";
  const state = newState(parseWorkflow(VALID), "demo-change", at, "codex");
  assert.deepEqual(state, {
    schema: 1,
    workflow: "demo",
    change_name: "demo-change",
    change_dir: "openspec/changes/demo-change",
    status: "in_progress",
    current_step: "one",
    steps: { one: { started_at: at } },
    starts: [{ at, lead: "codex", mode: "new", step: "one" }],
    crosschecks: [],
    created_at: at,
    updated_at: at,
    completed_at: null,
  });
});

test("a state file is checked whole: its workflow name, starts, and calls", async () => {
  const fixture = makeFixture();
  const { next } = session(makeContext(fixture));
  await next({ change_name: CHANGE, start: true });
  const state = JSON.parse(fixture.read(STATE));
  assert.equal(state.workflow, "define-openspec-change");
  const broken: Array<[(copy: Record<string, unknown>) => void, RegExp]> = [
    [(copy) => (copy.workflow = "another-workflow"), /workflow:/],
    [(copy) => (copy.starts = [{ at: "x", lead: "claude", mode: "later", step: "proposal" }]), /starts\[0\]\.mode/],
    [(copy) => (copy.calls = [{ call_id: 1 }]), /calls\[0\]\.call_id/],
    [(copy) => (copy.starts = "none"), /starts:/],
    [(copy) => (copy.current_step = "tasks"), /current_step: must be one of proposal, specs/],
    // The finish step commits change_dir, so it must be the change's own folder.
    [(copy) => (copy.change_dir = "."), /change_dir:/],
  ];
  for (const [damage, pattern] of broken) {
    const copy = structuredClone(state);
    damage(copy);
    fixture.write(STATE, JSON.stringify(copy));
    const result = await next({ change_name: CHANGE });
    assert.equal(result.isError, true);
    assert.match(result.text, pattern);
    assert.match(result.text, /\.define-openspec-change\.json is not a define-openspec-change state file this version understands/);
  }
});

test("config refusals from start and crosscheck give setup guidance without side effects", async () => {
  const fixture = makeFixture();
  const { calls, next } = session(makeContext(fixture, { extraEnv: { PATH: pathWithout(fixture, ["codex"]) } }));
  for (const invalid of [null, "human-workflows: [", "human-workflows:\n  crosscheck:\n    - cli: codex\n"]) {
    writeConfig(fixture, invalid);
    const start = await next({ start: true, change_name: CHANGE });
    assert.equal(start.isError, true);
    assert.match(start.text, /define-openspec-change:setup/);
    assert.equal(existsSync(join(fixture.repo, "openspec", "changes", CHANGE)), false);
    const crosscheck = await calls.start("review");
    assert.equal(crosscheck.isError, true);
    assert.equal(JSON.parse(crosscheck.text).error.code, "crosscheck_not_configured");
    assert.match(JSON.parse(crosscheck.text).error.message, /define-openspec-change:setup/);
  }
  assert.deepEqual(fakeLog(fixture), []);
});

test("INTEG-6: installing supported acpx mid-session unblocks both entry points and caches success", async () => {
  const fixture = makeFixture();
  const context = makeContext(fixture, { extraEnv: { FAKE_PROBE_LOG: "1" } });
  const { calls, next } = session(context);
  for (const version of [undefined, "0.22.9", "0.23.0"]) {
    context.env.PATH = version ? fixture.env.PATH : pathWithout(fixture, ["acpx"]);
    context.env.FAKE_ACPX_VERSION = version;
    const start = await next({ start: true, change_name: CHANGE });
    const review = await calls.start("review");
    if (version === "0.23.0") {
      assert.equal(start.isError, undefined);
      assert.equal(JSON.parse(review.text).status, "succeeded");
    } else {
      assert.equal(start.isError, true);
      assert.match(start.text, /acpx 0\.23.*define-openspec-change:setup/);
      assert.equal(existsSync(join(fixture.repo, "openspec", "changes", CHANGE)), false);
      assert.equal(review.isError, true);
      assert.equal(JSON.parse(review.text).error.code, "crosscheck_not_configured");
      assert.match(JSON.parse(review.text).error.message, /acpx 0\.23.*define-openspec-change:setup/);
      assert.equal(fakeLog(fixture).filter(({ bin }) => bin === "acpx").length, 0);
    }
  }
  assert.equal(fakeLog(fixture).filter(({ bin }) => bin === "version").length, 3);
});

test("INTEG-5: named reviews record current progress and keep legacy calls", async () => {
  const fixture = makeFixture();
  const { calls, next } = session(makeContext(fixture));
  assert.equal((await next({ change_name: CHANGE, start: true })).isError, undefined);
  const startedState = JSON.parse(fixture.read(STATE));
  assert.deepEqual(startedState.crosschecks, []);
  assert.equal(startedState.schema, 1);
  assert.equal(startedState.calls, undefined);
  writeArtifacts(fixture, CHANGE, "proposal");
  await next({ change_name: CHANGE });
  const legacyChange = "legacy-change";
  const legacyPath = `openspec/changes/${legacyChange}/${STATE_FILE}`;
  assert.equal((await next({ change_name: legacyChange, start: true })).isError, undefined);
  writeArtifacts(fixture, legacyChange, "proposal");
  await next({ change_name: legacyChange });
  const legacy = JSON.parse(fixture.read(legacyPath));
  delete legacy.crosschecks;
  const previous = {
    call_id: "call-old", step: "proposal", cli: "codex", model: "old-model", effort: "high", status: "succeeded",
    started_at: legacy.created_at, ended_at: legacy.created_at,
  };
  fixture.write(legacyPath, JSON.stringify({ ...legacy, calls: [previous] }));
  const legacyBefore = fixture.read(legacyPath);

  assert.equal(JSON.parse((await calls.start("named", fixture.repo, CHANGE)).text).status, "succeeded");
  const recorded = JSON.parse(fixture.read(STATE));
  const [entry] = recorded.crosschecks;
  assert.equal(recorded.crosschecks.length, 1);
  assert.equal(entry.step, "specs");
  assert.equal(entry.status, "succeeded");
  assert.equal(entry.working_tree, "unchanged");
  assert.ok(Date.parse(entry.ended_at) >= Date.parse(entry.started_at));
  assert.deepEqual(entry.reviewers, [{ cli: "codex", effort: "high", effort_applied: true, status: "succeeded" }]);

  assert.equal(fixture.read(legacyPath), legacyBefore);
  const currentSaved = fixture.read(STATE);
  const resumed = await next({ change_name: legacyChange, start: true });
  assert.match(resumed.text, /Resuming step: "specs"/);
  assert.equal(JSON.parse((await calls.start("new review", fixture.repo, legacyChange)).text).status, "succeeded");
  const migrated = JSON.parse(fixture.read(legacyPath));
  assert.deepEqual(migrated.calls, [previous]);
  assert.equal(migrated.crosschecks.length, 1);
  assert.notEqual(migrated.crosschecks[0].crosscheck_id, entry.crosscheck_id);
  assert.equal(fixture.read(STATE), currentSaved);

  const legacySaved = fixture.read(legacyPath);
  assert.equal(JSON.parse((await calls.start("unnamed")).text).status, "succeeded");
  assert.equal(fixture.read(STATE), currentSaved);
  assert.equal(fixture.read(legacyPath), legacySaved);
});

test("INTEG-5: unnamed reviews run outside git and invalid named reviews never launch", async () => {
  const fixture = makeFixture();
  const { calls, next } = session(makeContext(fixture));
  assert.equal(JSON.parse((await calls.start("standalone", fixture.dir)).text).working_tree, "unknown");
  await next({ change_name: CHANGE, start: true });
  const active = JSON.parse(fixture.read(STATE));
  fixture.write(STATE, JSON.stringify({ ...active, status: "complete", current_step: null }));
  for (const [cwd, name] of [[fixture.repo, CHANGE], [fixture.repo, "missing"], [fixture.dir, CHANGE], [fixture.repo, "../escape"]] as const) {
    const refused = await calls.start("invalid named review", cwd, name);
    assert.equal(refused.isError, true);
    assert.equal(JSON.parse(refused.text).error.code, "define_not_in_progress");
  }
  assert.equal(fakeLog(fixture).filter(({ bin }) => bin === "acpx").length, 1);
});


test("acpx probe refusals distinguish launch errors, exits, signals, and old versions", () => {
  const empty = { stdout: "", stderr: "" };
  assert.match(acpxProbeRefusal({ ...empty, code: null, launchError: "spawn ENOENT" }) ?? "", /could not start.*spawn ENOENT/);
  assert.match(acpxProbeRefusal({ ...empty, code: null }) ?? "", /killed or timed out/);
  assert.match(acpxProbeRefusal({ ...empty, code: 7, stderr: "Node is too old" }) ?? "", /exit 7.*Node is too old/);
  assert.match(acpxProbeRefusal({ ...empty, code: 0, stdout: "0.22.9\n" }) ?? "", /requires acpx 0\.23.*0\.22\.9.*setup/);
  assert.equal(acpxProbeRefusal({ ...empty, code: 0, stdout: "0.23.0\n" }), undefined);
});

test("settled batch status reflects completed reviewer outcomes", () => {
  const success = { outcome: { status: "succeeded", response: "review" } } as const;
  const failure = { outcome: { status: "failed", code: "timeout", error: "timed out" } } as const;
  const canceled = { outcome: { status: "canceled" } } as const;
  assert.equal(settledStatus([success]), "succeeded");
  assert.equal(settledStatus([success, failure]), "failed");
  assert.equal(settledStatus([success, canceled]), "canceled");
});
