import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { STATE_FILE } from "../src/state.js";
import { CHANGE, defined, driveToApproachReview, fakeLog, makeContext, makeFixture, session } from "./helpers.js";

const DIR = `openspec/changes/${CHANGE}`;

type Fixture = ReturnType<typeof makeFixture>;

/** A session driven to approach-review, so its next next_step call finishes the define. */
async function atApproachReview(fixture: Fixture, extraEnv?: NodeJS.ProcessEnv) {
  const { next } = session(makeContext(fixture, extraEnv ? { extraEnv } : {}));
  await driveToApproachReview(next, fixture);
  return next;
}

/** Makes the finishing call, which must be refused with the state file left as it was. */
async function refusedFinish(fixture: Fixture, next: Awaited<ReturnType<typeof atApproachReview>>) {
  const before = fixture.read(`${DIR}/${STATE_FILE}`);
  const result = await next({ change_name: CHANGE });
  assert.equal(result.isError, true);
  assert.equal(fixture.read(`${DIR}/${STATE_FILE}`), before, "the state file is unchanged");
  return result;
}

/** Installs a pre-commit hook with this script, so commits fail. */
function failPreCommit(fixture: Fixture, script: string): void {
  const hook = join(fixture.repo, ".git", "hooks", "pre-commit");
  writeFileSync(hook, script);
  chmodSync(hook, 0o755);
}

/** The commit the remote's copy of a branch points at. */
function pushedHead(fixture: Fixture, branch: string): string {
  return fixture.git("ls-remote", "origin", `refs/heads/${branch}`).split("\t")[0] ?? "";
}

function committedFiles(fixture: Fixture): string[] {
  return fixture.git("show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean).sort();
}

test("on the default branch it validates, commits only the change folder, and pushes nothing", async () => {
  const fixture = makeFixture({ remote: true });
  fixture.write("unrelated.txt", "staged but not part of the define\n");
  fixture.git("add", "unrelated.txt");
  const next = await atApproachReview(fixture);
  const remoteBefore = fixture.git("ls-remote", "origin", "refs/heads/main");

  const result = await next({ change_name: CHANGE });
  assert.equal(result.isError, undefined, result.text);
  assert.ok(result.text.includes(fixture.git("rev-parse", "--short", "HEAD")), "it reports the commit");
  assert.ok(result.text.includes("unrelated.txt"), "it reports what it left uncommitted");
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
  const next = await atApproachReview(fixture);

  const result = await next({ change_name: CHANGE });
  assert.equal(result.isError, undefined, result.text);
  assert.ok(result.text.includes("https://github.com/example/fixture/pull/7"), "it reports the pull request");
  assert.equal(pushedHead(fixture, "feat/reading-time"), fixture.git("rev-parse", "HEAD"));
  const gh = fakeLog(fixture).filter((entry) => entry.bin === "gh");
  assert.equal(gh.length, 1);
  const args = defined(gh[0]).args;
  assert.deepEqual(args.slice(0, 7), ["pr", "create", "--base", "main", "--head", "feat/reading-time", "--title"]);
  assert.ok(defined(args[7]).includes(CHANGE));
  assert.equal(args[8], "--body");
  assert.ok(defined(args[9]).includes(`${DIR}/specs/reading-time/spec.md`), "the body lists the change's files");
});

test("a push failure is reported once, with the commit kept and no pull request", async () => {
  const fixture = makeFixture({ remote: true, branch: "feat/reading-time" });
  fixture.git("remote", "set-url", "origin", join(fixture.dir, "missing.git"));
  const next = await atApproachReview(fixture);

  const result = await next({ change_name: CHANGE });
  assert.equal(result.isError, undefined, result.text);
  assert.equal(fakeLog(fixture).some((entry) => entry.bin === "gh" && entry.args[0] === "pr"), false);
  assert.equal(fixture.git("log", "-1", "--format=%s"), `chore: add change documents for ${CHANGE}`);
  const head = fixture.git("rev-parse", "HEAD");

  const again = await next({ change_name: CHANGE });
  assert.equal(again.isError, undefined);
  assert.equal(fixture.git("rev-parse", "HEAD"), head, "a later call commits nothing more");
  assert.equal(fakeLog(fixture).some((entry) => entry.bin === "gh"), false, "a later call opens no pull request");
});

test("a pull request failure is reported after the push", async () => {
  const fixture = makeFixture({ remote: true, branch: "feat/reading-time" });
  const next = await atApproachReview(fixture, { FAKE_GH_FAIL: "1" });

  const result = await next({ change_name: CHANGE });
  assert.ok(result.text.includes("GraphQL: pull request create failed"), "gh's error is passed on");
  assert.equal(pushedHead(fixture, "feat/reading-time"), fixture.git("rev-parse", "HEAD"));
  assert.equal(fakeLog(fixture).filter((entry) => entry.bin === "gh").length, 1);
});

test("a repository with no remote on main commits only", async () => {
  const fixture = makeFixture();
  const next = await atApproachReview(fixture);
  const result = await next({ change_name: CHANGE });
  assert.equal(result.isError, undefined, result.text);
  assert.equal(fixture.git("log", "-1", "--format=%s"), `chore: add change documents for ${CHANGE}`);
  assert.equal(fixture.git("remote"), "");
});

test("validation failures are refused and nothing is committed", async () => {
  const fixture = makeFixture({ remote: true });
  const next = await atApproachReview(fixture, { FAKE_OPENSPEC_VALIDATE_FAIL: "1" });
  fixture.write(`${DIR}/design.md`, "");
  const head = fixture.git("rev-parse", "HEAD");

  const result = await next({ change_name: CHANGE });
  assert.equal(result.isError, true);
  assert.ok(result.text.includes("Change has issues: no deltas"), "openspec's output is passed on");
  assert.ok(result.text.includes(`${DIR}/design.md`), "it names the empty artifact");
  assert.equal(fixture.git("rev-parse", "HEAD"), head);
  assert.equal(JSON.parse(fixture.read(`${DIR}/${STATE_FILE}`)).current_step, "approach-review");
});

test("a failed commit restores the state file and unstages the change", async () => {
  const fixture = makeFixture();
  failPreCommit(fixture, "#!/bin/sh\necho 'hook says no' >&2\nexit 1\n");
  const next = await atApproachReview(fixture);

  const result = await refusedFinish(fixture, next);
  assert.ok(result.text.includes("hook says no"), "the hook's output is passed on");
  assert.equal(fixture.git("diff", "--cached", "--name-only"), "");
  assert.equal(fixture.git("log", "-1", "--format=%s"), "initial");
});

test("a failed commit keeps what the user had staged", async () => {
  const fixture = makeFixture();
  failPreCommit(fixture, "#!/bin/sh\nexit 1\n");
  const next = await atApproachReview(fixture);
  fixture.write(`${DIR}/design.md`, "staged version\n");
  fixture.git("add", `${DIR}/design.md`);
  fixture.write(`${DIR}/design.md`, "later edit\n");

  const result = await next({ change_name: CHANGE });
  assert.equal(result.isError, true);
  assert.equal(fixture.git("show", `:${DIR}/design.md`), "staged version");
  assert.equal(fixture.read(`${DIR}/design.md`), "later edit\n");
  assert.equal(fixture.git("diff", "--cached", "--name-only").trim(), `${DIR}/design.md`);
});

test("a merge conflict in the change folder is refused before the index changes", async () => {
  const fixture = makeFixture();
  const next = await atApproachReview(fixture);
  const blob = fixture.git("hash-object", "-w", `${DIR}/design.md`);
  const stages = [1, 2, 3].map((stage) => `100644 ${blob} ${stage}\t${DIR}/design.md\n`).join("");
  execFileSync("git", ["update-index", "--index-info"], { cwd: fixture.repo, env: fixture.env, input: stages });

  const result = await refusedFinish(fixture, next);
  assert.ok(result.text.includes(`${DIR}/design.md`), "it names the conflicted file");
  assert.equal(fixture.git("ls-files", "-u", "--", `${DIR}/design.md`).split("\n").length, 3, "the conflict stages are kept");
  assert.equal(fixture.git("log", "-1", "--format=%s"), "initial");
});

test("the push runs with git terminal prompts off", async () => {
  const fixture = makeFixture({ remote: true, branch: "feature/define" });
  const seen = join(fixture.dir, "prompt-setting.txt");
  const hook = join(fixture.repo, ".git", "hooks", "pre-push");
  writeFileSync(hook, `#!/bin/sh\nprintf '%s' "$GIT_TERMINAL_PROMPT" > '${seen}'\n`);
  chmodSync(hook, 0o755);
  const next = await atApproachReview(fixture);
  await next({ change_name: CHANGE });
  assert.equal(readFileSync(seen, "utf8"), "0");
});
