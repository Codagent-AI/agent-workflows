import { artifactFiles, missingForSteps } from "./checks.js";
import { type Context, logEvent } from "./context.js";
import { output, type RunResult, run, tail } from "./proc.js";
import { readStateText, type DefineState, writeState, writeStateText } from "./state.js";
import { lastStepId, stepIds } from "./steps.js";

export interface ToolText {
  text: string;
  isError?: boolean;
}

type Git = (...args: string[]) => Promise<RunResult>;

/** Runs git with terminal prompts off, so a missing credential fails fast instead of waiting on a terminal. */
function gitRunner(root: string, env: NodeJS.ProcessEnv): Git {
  return (...args) => run("git", args, { cwd: root, env: { ...env, GIT_TERMINAL_PROMPT: "0" } });
}

/**
 * The staged entries (mode,object,path) under a folder, so a failed commit can put them back, and the
 * paths with merge conflicts, whose stages restoring the index could not bring back.
 */
async function indexEntries(git: Git, dir: string): Promise<{ staged: string[]; unmerged: string[] }> {
  const listed = await git("ls-files", "-s", "-z", "--", dir);
  const staged: string[] = [];
  const unmerged = new Set<string>();
  for (const entry of listed.stdout.split("\0").filter(Boolean)) {
    const match = entry.match(/^(\d+) ([0-9a-f]+) (\d)\t(.*)$/s);
    if (match?.[3] === "0") {
      staged.push(`${match[1]},${match[2]},${match[4]}`);
    } else if (match?.[4] !== undefined) {
      unmerged.add(match[4]);
    }
  }
  return { staged, unmerged: [...unmerged] };
}

/** Puts the index under `dir` back to `entries`, leaving the working tree alone. Returns the paths it could not put back. */
async function restoreIndex(git: Git, dir: string, entries: string[]): Promise<string[]> {
  const current = (await git("ls-files", "-z", "--", dir)).stdout.split("\0").filter(Boolean);
  if (current.length > 0) {
    await git("update-index", "--force-remove", "--", ...current);
  }
  const unrestored: string[] = [];
  for (const entry of entries) {
    if ((await git("update-index", "--add", "--cacheinfo", entry)).code !== 0) {
      unrestored.push(entry.split(",").slice(2).join(","));
    }
  }
  return unrestored;
}

function conflictRefusal(dir: string, unmerged: string[]): ToolText {
  return {
    text: [
      `Refused: ${dir}/ has unresolved merge conflicts (${unmerged.join(", ")}), so nothing was committed.`,
      "",
      "Tell the user to resolve them, then call next_step again.",
    ].join("\n"),
    isError: true,
  };
}

function commitFailure(dir: string, commit: RunResult, unrestored: string[]): ToolText {
  const lost =
    unrestored.length > 0 ? ["", `The staged state could not be put back for: ${unrestored.join(", ")}. Stage these paths again before retrying.`] : [];
  return {
    text: [
      `Validation passed, but committing ${dir}/ failed, so the define is not finished:`,
      tail(output(commit)),
      ...lost,
      "",
      "Tell the user what failed. After it is fixed, call next_step again to retry the commit.",
    ].join("\n"),
    isError: true,
  };
}

export function commitMessage(changeName: string): string {
  return `chore: add change documents for ${changeName}`;
}

/** The repository's default branch, or undefined when it cannot be told. */
export async function defaultBranch(root: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const git = gitRunner(root, env);
  const originHead = await git("symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD");
  if (originHead.code === 0 && originHead.stdout.trim().startsWith("origin/")) {
    return originHead.stdout.trim().slice("origin/".length);
  }
  const origin = await git("remote", "get-url", "origin");
  if (origin.code === 0) {
    const gh = await run("gh", ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"], {
      cwd: root,
      env: { ...env, GH_PROMPT_DISABLED: "1" },
    });
    const name = gh.stdout.trim();
    return gh.code === 0 && name !== "" ? name : undefined;
  }
  const configured = (await git("config", "--get", "init.defaultBranch")).stdout.trim();
  for (const candidate of [configured, "main", "master"]) {
    if (candidate && (await git("show-ref", "--verify", "--quiet", `refs/heads/${candidate}`)).code === 0) {
      return candidate;
    }
  }
  return undefined;
}

function prBody(state: DefineState, root: string): string {
  const files = artifactFiles(root, state.change_name);
  return [
    `Change documents for OpenSpec change \`${state.change_name}\`, written with the define-openspec-change plugin.`,
    "",
    ...files.map((file) => `- \`${file}\``),
    "",
    `Validated with \`openspec validate --type change ${state.change_name}\`.`,
  ].join("\n");
}

/** The refusal to return when the change fails openspec validation or lacks any step's artifact. */
async function validationRefusal(context: Context, root: string, state: DefineState): Promise<ToolText | undefined> {
  const name = state.change_name;
  const validation = await run("openspec", ["validate", "--type", "change", name, "--no-interactive"], {
    cwd: root,
    env: context.env,
  });
  const lacking = await missingForSteps(root, name, stepIds(context.workflow), context.env);
  if (validation.code === 0 && lacking.length === 0) {
    return undefined;
  }
  logEvent(context, root, "finish_refused", { change: name, validation: validation.code, missing: lacking });
  const lines = [`Refused: OpenSpec change "${name}" failed validation, so nothing was committed.`];
  if (validation.code !== 0) {
    lines.push("", `openspec validate --type change ${name}:`, tail(output(validation), 4000));
  }
  if (lacking.length > 0) {
    lines.push("", "Missing artifacts:", ...lacking.map((failure) => `- ${failure}`));
  }
  lines.push("", "Fix these with the user, then call next_step again.");
  return { text: lines.join("\n"), isError: true };
}

/**
 * Marks the define complete and commits only the change folder. If the commit fails, the state file
 * goes back to what it was and the index goes back to what the user had staged, so the next call retries.
 */
async function commitChange(context: Context, root: string, state: DefineState, git: Git): Promise<{ failure: ToolText } | { sha: string }> {
  const name = state.change_name;
  const dir = state.change_dir;
  const { staged, unmerged } = await indexEntries(git, dir);
  if (unmerged.length > 0) {
    return { failure: conflictRefusal(dir, unmerged) };
  }
  const previous = readStateText(root, name);
  const at = context.now().toISOString();
  state.status = "complete";
  state.current_step = null;
  state.completed_at = at;
  const last = lastStepId(context.workflow);
  state.steps[last] = { started_at: state.steps[last]?.started_at ?? at, completed_at: at };
  writeState(root, state, at);

  const add = await git("add", "--", dir);
  const commit = add.code === 0 ? await git("commit", "-m", commitMessage(name), "--", dir) : add;
  if (commit.code === 0) {
    return { sha: (await git("rev-parse", "--short", "HEAD")).stdout.trim() };
  }
  if (previous !== undefined) {
    writeStateText(root, name, previous);
  }
  const unrestored = await restoreIndex(git, dir, staged);
  logEvent(context, root, "finish_commit_failed", { change: name, unrestored });
  return { failure: commitFailure(dir, commit, unrestored) };
}

/**
 * Other work in the tree stays as it was. Name it, because `openspec new change` can create
 * openspec/config.yaml outside the change folder, and the user should know it is not committed.
 */
async function leftoverLines(git: Git): Promise<string[]> {
  const status = await git("status", "--porcelain=v1", "--untracked-files=all");
  const leftover = status.stdout.split("\n").filter(Boolean).map((line) => line.slice(3));
  if (leftover.length === 0) {
    return [];
  }
  const more = leftover.length > 10 ? `, and ${leftover.length - 10} more` : "";
  return [`Not committed, left as they were: ${leftover.slice(0, 10).join(", ")}${more}.`];
}

interface PushTarget {
  branch: string;
  base: string;
}

interface Published {
  outcome: string;
  lines: string[];
}

/** Pushes the branch and opens a pull request against the default branch. Nothing is retried. */
async function pushAndOpenPr(root: string, env: NodeJS.ProcessEnv, state: DefineState, target: PushTarget): Promise<Published> {
  const { branch, base } = target;
  const push = await gitRunner(root, env)("push", "-u", "origin", branch);
  if (push.code !== 0) {
    return {
      outcome: "push_failed",
      lines: [`Push failed: ${tail(output(push), 1500)}`, "No pull request was opened, and nothing was retried."],
    };
  }
  const pr = await run(
    "gh",
    ["pr", "create", "--base", base, "--head", branch, "--title", `Define OpenSpec change ${state.change_name}`, "--body", prBody(state, root)],
    { cwd: root, env: { ...env, GH_PROMPT_DISABLED: "1" } },
  );
  if (pr.code !== 0) {
    return {
      outcome: "pr_failed",
      lines: [`Pushed ${branch} to origin, but opening the pull request failed: ${tail(output(pr), 1500)}`, "Nothing was retried."],
    };
  }
  const url = pr.stdout.trim().split("\n").pop() ?? "";
  return { outcome: "pr_opened", lines: [`Pushed ${branch} to origin and opened a pull request against ${base}: ${url}`] };
}

/** Pushes and opens a pull request when the branch is not the default branch; otherwise says why not. */
async function publishBranch(root: string, env: NodeJS.ProcessEnv, state: DefineState, branch: string | undefined): Promise<Published & { base?: string | undefined }> {
  const base = await defaultBranch(root, env);
  if (branch === undefined) {
    return { base, outcome: "detached", lines: ["HEAD is detached, so nothing was pushed. The user pushes when ready."] };
  }
  if (base === undefined) {
    return {
      base,
      outcome: "unknown_default",
      lines: [`Could not tell the repository's default branch, so ${branch} was not pushed. The user pushes when ready.`],
    };
  }
  if (branch === base) {
    return { base, outcome: "default_branch", lines: [`On the default branch ${branch}, so nothing was pushed. The user pushes when ready.`] };
  }
  return { base, ...(await pushAndOpenPr(root, env, state, { branch, base })) };
}

/**
 * Finishes a define after approach-review: validates, commits only the change folder, then pushes
 * and opens a pull request when the current branch is not the default branch.
 */
export async function finishDefine(context: Context, root: string, state: DefineState): Promise<ToolText> {
  const refusal = await validationRefusal(context, root, state);
  if (refusal) {
    return refusal;
  }
  const name = state.change_name;
  const git = gitRunner(root, context.env);
  const committed = await commitChange(context, root, state, git);
  if ("failure" in committed) {
    return committed.failure;
  }
  const { sha } = committed;

  const lines = [
    `OpenSpec change "${name}" is defined.`,
    "Validation passed: openspec validate and every step's artifact check.",
    `Committed ${sha} "${commitMessage(name)}" with only ${state.change_dir}/.`,
    ...(await leftoverLines(git)),
  ];
  const branchResult = await git("symbolic-ref", "--quiet", "--short", "HEAD");
  const branch = branchResult.code === 0 ? branchResult.stdout.trim() : undefined;
  const { base, outcome, lines: publishLines } = await publishBranch(root, context.env, state, branch);
  lines.push(...publishLines, "", "Tell the user the define workflow is finished and pass on the result above. Do not call next_step again.");
  logEvent(context, root, "finished", { change: name, sha, branch, base, outcome });
  return { text: lines.join("\n") };
}
