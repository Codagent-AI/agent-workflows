import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { STATE_FILE } from "../src/state.js";
import { allowsCallAgent, loadWorkflow, parseWorkflow, type RenderInput, renderStep, stepIds, WorkflowError } from "../src/steps.js";
import {
  CHANGE,
  currentStep,
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

/** A refused start left no change folder and ran nothing. */
function assertNothingStarted(fixture: ReturnType<typeof makeFixture>): void {
  assert.equal(existsSync(join(fixture.repo, "openspec", "changes", CHANGE)), false);
  assert.deepEqual(fakeLog(fixture), []);
}

/** The text next_step returns for a step: the step as renderStep builds it for this context. */
function stepText(context: ReturnType<typeof makeContext>, input: Omit<RenderInput, "workflow" | "pluginRoot">): string {
  return renderStep({ workflow: context.workflow, pluginRoot: context.pluginRoot, ...input });
}

test("start creates the change and returns the proposal step", async () => {
  const fixture = makeFixture();
  const context = makeContext(fixture);
  const { next } = session(context);
  const result = await next({ change_name: CHANGE, start: true });

  assert.equal(result.isError, undefined);
  assert.equal(result.text, stepText(context, { changeName: CHANGE, step: "proposal", mode: "new", completed: [] }));
  assert.doesNotMatch(result.text, /\{\{/);

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
  }
  const missing = await next({ start: true });
  assert.equal(missing.isError, true);
  assert.deepEqual(fakeLog(fixture), []);
});

test("an existing change that define did not start is refused", async () => {
  const fixture = makeFixture();
  fixture.write(`openspec/changes/${CHANGE}/proposal.md`, "existing\n");
  const { next } = session(makeContext(fixture));

  const start = await next({ change_name: CHANGE, start: true });
  assert.equal(start.isError, true);
  const advance = await next({ change_name: CHANGE });
  assert.equal(advance.isError, true);
  assert.deepEqual(fakeLog(fixture), []);
  assert.equal(existsSync(join(fixture.repo, STATE)), false);
});

test("start is refused until the crosscheck is configured, and nothing is created", async () => {
  const fixture = makeFixture({ config: null });
  const { next } = session(makeContext(fixture));
  const refused = await next({ change_name: CHANGE, start: true });
  assert.equal(refused.isError, true);
  assertNothingStarted(fixture);

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
  assertNothingStarted(fixture);
});

test("an early next_step is refused and names the missing file", async () => {
  const fixture = makeFixture();
  const context = makeContext(fixture);
  const { next } = session(context);
  await next({ change_name: CHANGE, start: true });

  const early = await next({ change_name: CHANGE });
  assert.equal(early.isError, true);
  assert.ok(early.text.includes(`openspec/changes/${CHANGE}/proposal.md`));
  assert.equal(currentStep(fixture), "proposal");

  fixture.write(`openspec/changes/${CHANGE}/proposal.md`, "");
  const empty = await next({ change_name: CHANGE });
  assert.equal(empty.isError, true, "an empty proposal does not count");

  writeArtifacts(fixture, CHANGE, "proposal");
  const specs = await next({ change_name: CHANGE });
  assert.equal(specs.isError, undefined);
  assert.equal(specs.text, stepText(context, { changeName: CHANGE, step: "specs", mode: "continue", completed: [] }));

  fixture.write(`openspec/changes/${CHANGE}/specs/notes.md`, "not a capability spec\n");
  const looseSpec = await next({ change_name: CHANGE });
  assert.equal(looseSpec.isError, true);
  assert.equal(currentStep(fixture), "specs");
});

test("an artifact OpenSpec reports no status for is not done", async () => {
  const fixture = makeFixture();
  const { next } = session(makeContext(fixture, { extraEnv: { FAKE_OPENSPEC_STATUS_OMIT: "proposal" } }));
  await next({ change_name: CHANGE, start: true });
  writeArtifacts(fixture, CHANGE, "proposal");

  const result = await next({ change_name: CHANGE });
  assert.equal(result.isError, true);
  assert.equal(currentStep(fixture), "proposal");
});

test("steps advance in workflow.yaml order", async () => {
  const fixture = makeFixture();
  const { next } = session(makeContext(fixture));
  await next({ change_name: CHANGE, start: true });
  const seen = [currentStep(fixture)];
  writeArtifacts(fixture);
  for (let i = 0; i < 4; i++) {
    const result = await next({ change_name: CHANGE });
    assert.equal(result.isError, undefined, result.text);
    seen.push(currentStep(fixture));
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

  const secondContext = makeContext(fixture, { client: "codex-mcp-client" });
  const second = session(secondContext);
  const resumed = await second.next({ change_name: CHANGE, start: true });
  assert.equal(resumed.isError, undefined);
  assert.equal(
    resumed.text,
    stepText(secondContext, { changeName: CHANGE, step: "design", mode: "resume", completed: ["proposal", "specs"] }),
  );

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

  await next({ change_name: CHANGE, start: true });
  writeArtifacts(fixture, CHANGE, "proposal");
  const result = await next({});
  assert.equal(result.isError, undefined);
  assert.equal(currentStep(fixture), "specs");

  await next({ change_name: "second-change", start: true });
  const ambiguous = await next({});
  assert.equal(ambiguous.isError, true);
  assert.ok(ambiguous.text.includes("add-reading-time, second-change"), "it names both defines");
});

test("a completed define refuses start and stays complete", async () => {
  const fixture = makeFixture();
  const { next } = session(makeContext(fixture));
  await next({ change_name: CHANGE, start: true });
  writeArtifacts(fixture);
  for (let i = 0; i < 5; i++) await next({ change_name: CHANGE });
  assert.equal(JSON.parse(fixture.read(STATE)).status, "complete");

  const again = await next({ change_name: CHANGE, start: true });
  assert.equal(again.isError, true);
  const advance = await next({ change_name: CHANGE });
  assert.equal(advance.isError, undefined);
  assert.equal(JSON.parse(fixture.read(STATE)).status, "complete");
});

test("a corrupt state file is refused, not overwritten", async () => {
  const fixture = makeFixture();
  fixture.write(STATE, "{not json");
  const { next } = session(makeContext(fixture));
  const result = await next({ change_name: CHANGE, start: true });
  assert.equal(result.isError, true);
  assert.equal(fixture.read(STATE), "{not json");
});

test("next_step outside a git repository is refused", async () => {
  const fixture = makeFixture();
  const { next } = session(makeContext(fixture, { cwd: fixture.dir }));
  const result = await next({ change_name: CHANGE, start: true });
  assert.equal(result.isError, true);
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

test("the shipped workflow.yaml has the five steps the artifact checks are keyed by", () => {
  const workflow = loadWorkflow(PLUGIN_ROOT);
  assert.equal(workflow.name, "define-openspec-change");
  assert.deepEqual(stepIds(workflow), ["proposal", "specs", "design", "test-plan", "approach-review"]);
  assert.deepEqual(
    stepIds(workflow).filter((id) => allowsCallAgent(workflow, id)),
    ["proposal", "approach-review"],
  );
});

const VALID = `name: demo
description: A demo.
steps:
  - id: one
    tools: [call_agent]
    prompt: |
      Do {{change_name}} with {{reviews_dir}}.
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

test("a malformed workflow.yaml is rejected and the error names the field", () => {
  const workflow = parseWorkflow(VALID);
  assert.deepEqual(stepIds(workflow), ["one", "two"]);
  assert.equal(allowsCallAgent(workflow, "one"), true);
  assert.equal(allowsCallAgent(workflow, "two"), false);

  malformed("steps: [");
  malformed("- just a list");
  const fields: Array<[string, string]> = [
    [VALID.replace("name: demo\n", ""), "name"],
    [VALID.replace("description: A demo.\n", ""), "description"],
    ["name: demo\ndescription: d\nsteps: []\n", "steps"],
    [VALID.replace("id: two", "id: one"), "steps[1].id"],
    [VALID.replace("    prompt: Finish.\n", ""), "steps[1].prompt"],
    [VALID.replace("[call_agent]", "[shell]"), "steps[0].tools[0]"],
    [VALID.replace("{{reviews_dir}}", "{{unknown}}"), "{{unknown}}"],
    [VALID.replace("{{reviews_dir}}", "{{skills_dir}}"), "{{skills_dir}}"],
    [`${VALID}shared_prompts:\n  every-step: Typo.\n`, "every-step"],
    [`${VALID}shared_prompts:\n  every_step: Use {{unknown}}.\n`, "shared_prompts.every_step"],
  ];
  for (const [text, field] of fields) {
    assert.ok(malformed(text).includes(field), field);
  }
});

test("shared prompts are added once after a step's own prompt, the call_agent text only where call_agent works", () => {
  const workflow = parseWorkflow(`${VALID}shared_prompts:\n  call_agent: Review rules for {{change_name}}.\n  every_step: Keep it interactive.\n`);
  const render = (step: string) =>
    renderStep({ workflow, pluginRoot: "/plugin", changeName: "demo-change", step, mode: "continue", completed: [] });
  assert.ok(render("one").includes("Do demo-change with /plugin/reviews.\n\nReview rules for demo-change.\n\nKeep it interactive.\n\n"));
  const two = render("two");
  assert.ok(two.includes("Finish.\n\nKeep it interactive.\n\n"));
  assert.equal(two.includes("Review rules"), false);
  assert.equal(two.split("Keep it interactive.").length, 2, "the shared text appears once");
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
    [(copy) => (copy.current_step = "tasks"), /current_step/],
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
  }
});
