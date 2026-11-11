import assert from "node:assert/strict";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { STATE_FILE } from "../src/state.js";
import { CHANGE, defined, driveToApproachReview, fakeLog, makeContext, makeFixture, session } from "./helpers.js";

const DIR = `openspec/changes/${CHANGE}`;

function committedFiles(fixture: ReturnType<typeof makeFixture>): string[] {
  return fixture.git("show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean).sort();
}

test("on the default branch it validates, commits only the change folder, and pushes nothing", async () => {
  const fixture = makeFixture({ remote: true });
  fixture.write("unrelated.txt", "staged but not part of the define\n");
  fixture.git("add", "unrelated.txt");
  const { next } = session(makeContext(fixture));
  await driveToApproachReview(next, fixture);
  const remoteBefore = fixture.git("ls-remote", "origin", "refs/heads/main");

  const result = await next({ change_name: CHANGE });
  assert.equal(result.isError, undefined, result.text);
  const sha = fixture.git("rev-parse", "--short", "HEAD");
  assert.equal(
    result.text,
    [
      `OpenSpec change "${CHANGE}" is defined.`,
      "Validation passed: openspec validate and the planning-artifact check.",
      `Committed ${sha} "chore: add change documents for ${CHANGE}" with only ${DIR}/.`,
      "Not committed, left as they were: unrelated.txt.",
      "On the default branch main, so nothing was pushed. The user pushes when ready.",
      "",
      "Tell the user the define workflow is finished and pass on the result above. Do not call next_step again.",
    ].join("\n"),
  );
  assert.equal(fixture.git("log", "-1", "--format=%s"), `chore: add change documents for ${CHANGE}`);
  assert.deepEqual(committedFiles(fixture), [
    `${DIR}/.define-openspec-change.json`,
    `${DIR}/.openspec.yaml`,
    `${DIR}/design.md`,
    `${DIR}/proposal.md`,
    `${DIR}/specs/reading-time/spec.md`,
    `${DIR}/test-plan.md`,
  ]);
  assert.equal(fixture.git("diff", "--cached", "--name-only"), "unrelated.txt", "other staged work stays staged");
  assert.equal(fixture.git("ls-remote", "origin", "refs/heads/main"), remoteBefore, "main was not pushed");
  assert.equal(fakeLog(fixture).some((entry) => entry.bin === "gh"), false);

  const state = JSON.parse(fixture.git("show", `HEAD:${DIR}/${STATE_FILE}`));
  assert.equal(state.status, "complete");
  assert.equal(state.current_step, null);
  assert.ok(state.completed_at);
  assert.ok(state.steps["approach-review"].completed_at);
  assert.deepEqual(
    fakeLog(fixture).filter((entry) => entry.args[0] === "validate").map((entry) => entry.args),
    [["validate", "--type", "change", CHANGE, "--no-interactive"]],
  );
});

test("on a feature branch it pushes the branch and opens a pull request against the default branch", async () => {
  const fixture = makeFixture({ remote: true, branch: "feat/reading-time" });
  const { next } = session(makeContext(fixture));
  await driveToApproachReview(next, fixture);

  const result = await next({ change_name: CHANGE });
  assert.equal(result.isError, undefined, result.text);
  assert.match(
    result.text,
    /Pushed feat\/reading-time to origin and opened a pull request against main: https:\/\/github\.com\/example\/fixture\/pull\/7/,
  );
  assert.equal(fixture.git("ls-remote", "origin", "refs/heads/feat/reading-time").split("\t")[0], fixture.git("rev-parse", "HEAD"));
  const gh = fakeLog(fixture).filter((entry) => entry.bin === "gh");
  assert.equal(gh.length, 1);
  const args = defined(gh[0]).args;
  assert.deepEqual(args.slice(0, 8), ["pr", "create", "--base", "main", "--head", "feat/reading-time", "--title", `Define OpenSpec change ${CHANGE}`]);
  assert.equal(args[8], "--body");
  assert.match(defined(args[9]), /- `openspec\/changes\/add-reading-time\/specs\/reading-time\/spec\.md`/);
});

test("a push failure is reported once, with the commit kept and no pull request", async () => {
  const fixture = makeFixture({ remote: true, branch: "feat/reading-time" });
  fixture.git("remote", "set-url", "origin", join(fixture.dir, "missing.git"));
  const { next } = session(makeContext(fixture));
  await driveToApproachReview(next, fixture);

  const result = await next({ change_name: CHANGE });
  assert.match(result.text, /Committed [0-9a-f]+ "chore: add change documents for add-reading-time"/);
  assert.match(result.text, /Push failed: .*\nNo pull request was opened, and nothing was retried\./s);
  assert.equal(fakeLog(fixture).some((entry) => entry.bin === "gh" && entry.args[0] === "pr"), false);
  assert.equal(fixture.git("log", "-1", "--format=%s"), `chore: add change documents for ${CHANGE}`);

  const again = await next({ change_name: CHANGE });
  assert.match(again.text, /is already defined/, "a later call does not retry the push");
});

test("a pull request failure is reported after the push", async () => {
  const fixture = makeFixture({ remote: true, branch: "feat/reading-time" });
  const { next } = session(makeContext(fixture, { extraEnv: { FAKE_GH_FAIL: "1" } }));
  await driveToApproachReview(next, fixture);

  const result = await next({ change_name: CHANGE });
  assert.match(result.text, /Pushed feat\/reading-time to origin, but opening the pull request failed: GraphQL: pull request create failed\nNothing was retried\./);
  assert.equal(fakeLog(fixture).filter((entry) => entry.bin === "gh").length, 1);
});

test("a repository with no remote on main commits only", async () => {
  const fixture = makeFixture();
  const { next } = session(makeContext(fixture));
  await driveToApproachReview(next, fixture);
  const result = await next({ change_name: CHANGE });
  assert.match(result.text, /On the default branch main, so nothing was pushed\./);
  assert.equal(fixture.git("remote"), "");
});

test("validation failures are refused and nothing is committed", async () => {
  const fixture = makeFixture({ remote: true });
  const { next } = session(makeContext(fixture, { extraEnv: { FAKE_OPENSPEC_VALIDATE_FAIL: "1" } }));
  await driveToApproachReview(next, fixture);
  fixture.write(`${DIR}/design.md`, "");
  const head = fixture.git("rev-parse", "HEAD");

  const result = await next({ change_name: CHANGE });
  assert.equal(result.isError, true);
  assert.equal(
    result.text,
    [
      `Refused: OpenSpec change "${CHANGE}" failed validation, so nothing was committed.`,
      "",
      `openspec validate --type change ${CHANGE}:`,
      "Change has issues: no deltas",
      "",
      "Planning artifacts:",
      `- missing or empty ${DIR}/design.md`,
      "",
      "Fix these with the user, then call next_step again.",
    ].join("\n"),
  );
  assert.equal(fixture.git("rev-parse", "HEAD"), head);
  assert.equal(JSON.parse(fixture.read(`${DIR}/${STATE_FILE}`)).current_step, "approach-review");
});

test("a failed commit restores the state file and unstages the change", async () => {
  const fixture = makeFixture();
  const hook = join(fixture.repo, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\necho 'hook says no' >&2\nexit 1\n");
  chmodSync(hook, 0o755);
  const { next } = session(makeContext(fixture));
  await driveToApproachReview(next, fixture);
  const before = fixture.read(`${DIR}/${STATE_FILE}`);

  const result = await next({ change_name: CHANGE });
  assert.equal(result.isError, true);
  assert.match(result.text, /committing openspec\/changes\/add-reading-time\/ failed[\s\S]*hook says no/);
  assert.equal(fixture.read(`${DIR}/${STATE_FILE}`), before);
  assert.equal(fixture.git("diff", "--cached", "--name-only"), "");
  assert.equal(fixture.git("log", "-1", "--format=%s"), "initial");
});
