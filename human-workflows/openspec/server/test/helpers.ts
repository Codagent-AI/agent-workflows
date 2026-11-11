import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CallManager } from "../src/agentcall.js";
import type { Context } from "../src/context.js";
import { nextStep, type NextStepArgs } from "../src/define.js";
import { loadWorkflow } from "../src/steps.js";

/** The real plugin folder, so tests use the shipped workflow.yaml. */
export const PLUGIN_ROOT = fileURLToPath(new URL("../../../plugin", import.meta.url));

const FAKE_OPENSPEC = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ bin: "openspec", args }) + "\\n");
const dir = (name) => path.join(process.cwd(), "openspec", "changes", name);
if (args[0] === "new" && args[1] === "change") {
  if (fs.existsSync(dir(args[2]))) { console.error("Change '" + args[2] + "' already exists"); process.exit(1); }
  fs.mkdirSync(dir(args[2]), { recursive: true });
  fs.writeFileSync(path.join(dir(args[2]), ".openspec.yaml"), "schema: spec-driven\\n");
  console.log("Created change '" + args[2] + "'");
} else if (args[0] === "status") {
  const name = args[args.indexOf("--change") + 1];
  const d = dir(name);
  if (!fs.existsSync(d)) { console.error("no change " + name); process.exit(1); }
  const has = (f) => fs.existsSync(path.join(d, f));
  const specs = fs.existsSync(path.join(d, "specs")) && fs.readdirSync(path.join(d, "specs"), { recursive: true }).some((f) => String(f).endsWith(".md"));
  const st = (done) => (done ? "done" : "ready");
  console.log(JSON.stringify({ changeName: name, artifacts: [
    { id: "proposal", status: st(has("proposal.md")) },
    { id: "design", status: st(has("design.md")) },
    { id: "specs", status: st(specs) },
    { id: "tasks", status: "blocked" },
  ].filter((artifact) => artifact.id !== process.env.FAKE_OPENSPEC_STATUS_OMIT) }));
} else if (args[0] === "validate") {
  if (process.env.FAKE_OPENSPEC_VALIDATE_FAIL) { console.error("Change has issues: no deltas"); process.exit(1); }
  console.log("Change is valid");
} else { console.error("fake openspec: unsupported " + args.join(" ")); process.exit(2); }
`;

const FAKE_CHILD = (cli: string) => `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const keep = Object.keys(process.env).filter((k) => k.startsWith("CLAUDE") || k.startsWith("FAKE_") || k.startsWith("DEFINE_"));
const prompt = fs.readFileSync(0, "utf8");
if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ bin: "${cli}", args, cwd: process.cwd(), env: keep, prompt }) + "\\n");
const delay = Number(process.env.FAKE_CHILD_SLEEP_MS || 0);
if (process.env.FAKE_CHILD_IGNORE_TERM) process.on("SIGTERM", () => {});
setTimeout(() => {
  if (process.env.FAKE_CHILD_WRITE) fs.writeFileSync(path.join(process.cwd(), process.env.FAKE_CHILD_WRITE), "written by child\\n");
  const code = Number(process.env.FAKE_CHILD_EXIT || 0);
  const response = process.env.FAKE_CHILD_RESPONSE || "${cli} review: no consequential findings.";
  if ("${cli}" === "codex") {
    const out = args[args.indexOf("-o") + 1];
    console.log(JSON.stringify({ type: "thread.started", thread_id: "t-1" }));
    if (code === 0) fs.writeFileSync(out, response);
    else { console.log(JSON.stringify({ type: "error", message: "model overloaded" })); console.error("codex failed"); }
  } else {
    console.log(JSON.stringify(code === 0
      ? { type: "result", subtype: "success", is_error: false, result: response, total_cost_usd: 0.25 }
      : { type: "result", subtype: "error_during_execution", is_error: true, result: "claude failed" }));
  }
  process.exit(code);
}, delay);
`;

const FAKE_GH = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ bin: "gh", args }) + "\\n");
if (args[0] === "pr" && args[1] === "create") {
  if (process.env.FAKE_GH_FAIL) { console.error("GraphQL: pull request create failed"); process.exit(1); }
  console.log("https://github.com/example/fixture/pull/7");
} else if (args[0] === "repo" && args[1] === "view") {
  if (process.env.FAKE_GH_DEFAULT) console.log(process.env.FAKE_GH_DEFAULT); else { console.error("no repo"); process.exit(1); }
} else { console.error("fake gh: unsupported"); process.exit(2); }
`;

export interface Fixture {
  dir: string;
  repo: string;
  remote?: string;
  log: string;
  env: NodeJS.ProcessEnv;
  git: (...args: string[]) => string;
  write: (relative: string, text: string) => void;
  read: (relative: string) => string;
  events: () => Array<Record<string, unknown>>;
}

/** The crosscheck config every fixture gets unless it asks for another: both CLIs, no model, high effort. */
export const DEFAULT_CONFIG = "human-workflows:\n  crosscheck:\n    - cli: codex\n      effort: high\n    - cli: claude\n      effort: high\n";

/** Writes (or with null, removes) the fixture's ~/.agent-workflows/config.yaml. */
export function writeConfig(fixture: Fixture, text: string | null): void {
  const dir = join(defined(fixture.env.HOME, "HOME"), ".agent-workflows");
  mkdirSync(dir, { recursive: true });
  if (text === null) {
    rmSync(join(dir, "config.yaml"), { force: true });
  } else {
    writeFileSync(join(dir, "config.yaml"), text);
  }
}

/** Every event the server logged under `base`, across the per-repository log folders. */
function readEvents(base: string): Array<Record<string, unknown>> {
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .map((sub) => join(base, sub, "events.jsonl"))
    .filter((file) => existsSync(file))
    .flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    );
}

/** Narrows a possibly undefined value, failing the test with a clear message instead of a non-null assertion. */
export function defined<T>(value: T | undefined, what = "value"): T {
  if (value === undefined) throw new Error(`expected ${what} to be defined`);
  return value;
}

/** The first fake CLI invocation made by `bin`. */
export function fakeCall(fixture: Fixture, bin: string): ReturnType<typeof fakeLog>[number] {
  return defined(fakeLog(fixture).find((entry) => entry.bin === bin), `a ${bin} call`);
}

/**
 * A temp git repo with fake openspec, codex, claude, and gh first on PATH, an isolated git config,
 * and a crosscheck config in its own HOME (`config: null` for none).
 */
export function makeFixture(options: { remote?: boolean; branch?: string; config?: string | null } = {}): Fixture {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "define-openspec-change-test-")));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const scripts: Record<string, string> = { openspec: FAKE_OPENSPEC, codex: FAKE_CHILD("codex"), claude: FAKE_CHILD("claude"), gh: FAKE_GH };
  for (const [name, text] of Object.entries(scripts)) {
    writeFileSync(join(bin, name), text);
    chmodSync(join(bin, name), 0o755);
  }
  const home = join(dir, "home");
  mkdirSync(home);
  writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n");
  const log = join(dir, "fake.log");
  const env: NodeJS.ProcessEnv = {
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    FAKE_LOG: log,
    TMPDIR: dir,
  };
  const repo = join(dir, "repo");
  const run = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8" });
  let remote: string | undefined;
  if (options.remote) {
    remote = join(dir, "remote.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote], { env });
    const seed = join(dir, "seed");
    execFileSync("git", ["clone", "-q", remote, seed], { env });
    writeFileSync(join(seed, "README.md"), "fixture\n");
    run(seed, ["add", "README.md"]);
    run(seed, ["commit", "-q", "-m", "initial"]);
    run(seed, ["push", "-q", "origin", "HEAD:main"]);
    execFileSync("git", ["clone", "-q", remote, repo], { env });
  } else {
    mkdirSync(repo);
    run(repo, ["init", "-q", "-b", "main"]);
    writeFileSync(join(repo, "README.md"), "fixture\n");
    run(repo, ["add", "README.md"]);
    run(repo, ["commit", "-q", "-m", "initial"]);
  }
  mkdirSync(join(repo, "openspec", "changes"), { recursive: true });
  if (options.branch) {
    run(repo, ["checkout", "-q", "-b", options.branch]);
  }
  const fixture: Fixture = {
    dir,
    repo,
    log,
    env,
    git: (...args) => run(repo, args).trim(),
    write: (relative, text) => {
      const path = join(repo, relative);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, text);
    },
    read: (relative) => readFileSync(join(repo, relative), "utf8"),
    events: () => readEvents(join(dir, "logs")),
  };
  if (remote) {
    fixture.remote = remote;
  }
  writeConfig(fixture, options.config === undefined ? DEFAULT_CONFIG : options.config);
  return fixture;
}

/**
 * A PATH that has node, git, and the fixture's fakes except `missing`, and none of the real CLIs, so a
 * test can say a CLI is not installed.
 */
export function pathWithout(fixture: Fixture, missing: string[]): string {
  const bin = join(fixture.dir, `bin-without-${missing.join("-")}`);
  mkdirSync(bin, { recursive: true });
  symlinkSync(process.execPath, join(bin, "node"));
  for (const name of ["openspec", "codex", "claude", "gh"].filter((candidate) => !missing.includes(candidate))) {
    copyFileSync(join(fixture.dir, "bin", name), join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  return [bin, "/usr/bin", "/bin"].join(delimiter);
}

export function fakeLog(fixture: Fixture): Array<{ bin: string; args: string[]; cwd?: string; env?: string[]; prompt?: string }> {
  if (!existsSync(fixture.log)) return [];
  return readFileSync(fixture.log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function makeContext(fixture: Fixture, overrides: Partial<Context> & { client?: string; extraEnv?: NodeJS.ProcessEnv } = {}): Context {
  const { client, extraEnv, ...rest } = overrides;
  return {
    cwd: fixture.repo,
    env: { ...fixture.env, ...extraEnv },
    pluginRoot: PLUGIN_ROOT,
    workflow: loadWorkflow(PLUGIN_ROOT),
    waitMs: 5_000,
    logBase: join(fixture.dir, "logs"),
    clientName: () => client ?? "claude-code",
    now: () => new Date(),
    ...rest,
  };
}

/** One server instance: its own call manager, like one MCP server process. */
export function session(context: Context) {
  const calls = new CallManager(context);
  return {
    calls,
    next: (args: NextStepArgs = {}) => nextStep(context, calls, args),
  };
}

export const CHANGE = "add-reading-time";

/** Writes every definition artifact for a change so each step's check passes. */
export function writeArtifacts(fixture: Fixture, change = CHANGE, upTo: "proposal" | "specs" | "design" | "test-plan" = "test-plan"): void {
  const dir = `openspec/changes/${change}`;
  fixture.write(`${dir}/proposal.md`, "## Why\n\nReaders want an estimate.\n");
  if (upTo === "proposal") return;
  fixture.write(
    `${dir}/specs/reading-time/spec.md`,
    "## ADDED Requirements\n\n### Requirement: Estimate\nThe page SHALL show minutes.\n\n#### Scenario: Shown\n- **WHEN** a page loads\n- **THEN** it shows minutes\n",
  );
  if (upTo === "specs") return;
  fixture.write(`${dir}/design.md`, "## Approach\n\nCount words.\n");
  if (upTo === "design") return;
  fixture.write(`${dir}/test-plan.md`, "## Coverage Strategy\n\nUnit tests.\n");
}

/** Drives a define from start to the approach-review step. */
export async function driveToApproachReview(next: (args?: NextStepArgs) => Promise<{ text: string; isError?: boolean }>, fixture: Fixture) {
  const started = await next({ change_name: CHANGE, start: true });
  if (started.isError) throw new Error(started.text);
  writeArtifacts(fixture);
  for (let i = 0; i < 4; i++) {
    const result = await next({ change_name: CHANGE });
    if (result.isError) throw new Error(result.text);
  }
}
