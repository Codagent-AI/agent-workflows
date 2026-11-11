import { nonEmptySpecs, planningArtifactFailures } from "./checks.js";
import { type Context, logEvent } from "./context.js";
import { output, run, tail } from "./proc.js";
import { readStateText, type DefineState, writeState, writeStateText } from "./state.js";

export interface ToolText {
  text: string;
  isError?: boolean;
}

export function commitMessage(changeName: string): string {
  return `chore: add change documents for ${changeName}`;
}

/** The repository's default branch, or undefined when it cannot be told. */
export async function defaultBranch(root: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const git = (...args: string[]) => run("git", args, { cwd: root, env });
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
  const dir = state.change_dir;
  const files = [`${dir}/proposal.md`, ...nonEmptySpecs(root, dir), `${dir}/design.md`, `${dir}/test-plan.md`];
  return [
    `Change documents for OpenSpec change \`${state.change_name}\`, written with the define-openspec-change plugin.`,
    "",
    ...files.map((file) => `- \`${file}\``),
    "",
    `Validated with \`openspec validate --type change ${state.change_name}\`.`,
  ].join("\n");
}

/**
 * Finishes a define after approach-review: validates, commits only the change folder, then pushes
 * and opens a pull request when the current branch is not the default branch.
 */
export async function finishDefine(context: Context, root: string, state: DefineState): Promise<ToolText> {
  const env = context.env;
  const name = state.change_name;
  const dir = state.change_dir;
  const git = (...args: string[]) => run("git", args, { cwd: root, env });

  const validation = await run("openspec", ["validate", "--type", "change", name, "--no-interactive"], {
    cwd: root,
    env,
  });
  const planning = planningArtifactFailures(root, dir);
  if (validation.code !== 0 || planning.length > 0) {
    logEvent(context, root, "finish_refused", { change: name, validation: validation.code, planning });
    const lines = [`Refused: OpenSpec change "${name}" failed validation, so nothing was committed.`];
    if (validation.code !== 0) {
      lines.push("", `openspec validate --type change ${name}:`, tail(output(validation), 4000));
    }
    if (planning.length > 0) {
      lines.push("", "Planning artifacts:", ...planning.map((failure) => `- ${failure}`));
    }
    lines.push("", "Fix these with the user, then call next_step again.");
    return { text: lines.join("\n"), isError: true };
  }

  const previous = readStateText(root, name);
  const at = context.now().toISOString();
  state.status = "complete";
  state.current_step = null;
  state.completed_at = at;
  state.steps["approach-review"] = { started_at: state.steps["approach-review"]?.started_at ?? at, completed_at: at };
  writeState(root, state, at);

  const message = commitMessage(name);
  const add = await git("add", "--", dir);
  const commit = add.code === 0 ? await git("commit", "-m", message, "--", dir) : add;
  if (commit.code !== 0) {
    if (previous !== undefined) {
      writeStateText(root, name, previous);
    }
    await git("reset", "-q", "--", dir);
    logEvent(context, root, "finish_commit_failed", { change: name });
    return {
      text: [
        `Validation passed, but committing ${dir}/ failed, so the define is not finished:`,
        tail(output(commit)),
        "",
        "Tell the user what failed. After it is fixed, call next_step again to retry the commit.",
      ].join("\n"),
      isError: true,
    };
  }
  const sha = (await git("rev-parse", "--short", "HEAD")).stdout.trim();

  const lines = [
    `OpenSpec change "${name}" is defined.`,
    "Validation passed: openspec validate and the planning-artifact check.",
    `Committed ${sha} "${message}" with only ${dir}/.`,
  ];
  const branchResult = await git("symbolic-ref", "--quiet", "--short", "HEAD");
  const branch = branchResult.code === 0 ? branchResult.stdout.trim() : undefined;
  const base = await defaultBranch(root, env);
  let outcome: string;

  if (branch === undefined) {
    outcome = "detached";
    lines.push("HEAD is detached, so nothing was pushed. The user pushes when ready.");
  } else if (base === undefined) {
    outcome = "unknown_default";
    lines.push(`Could not tell the repository's default branch, so ${branch} was not pushed. The user pushes when ready.`);
  } else if (branch === base) {
    outcome = "default_branch";
    lines.push(`On the default branch ${branch}, so nothing was pushed. The user pushes when ready.`);
  } else {
    const push = await git("push", "-u", "origin", branch);
    if (push.code !== 0) {
      outcome = "push_failed";
      lines.push(`Push failed: ${tail(output(push), 1500)}`, "No pull request was opened, and nothing was retried.");
    } else {
      const pr = await run(
        "gh",
        ["pr", "create", "--base", base, "--head", branch, "--title", `Define OpenSpec change ${name}`, "--body", prBody(state, root)],
        { cwd: root, env: { ...env, GH_PROMPT_DISABLED: "1" } },
      );
      const url = pr.stdout.trim().split("\n").pop() ?? "";
      if (pr.code !== 0) {
        outcome = "pr_failed";
        lines.push(
          `Pushed ${branch} to origin, but opening the pull request failed: ${tail(output(pr), 1500)}`,
          "Nothing was retried.",
        );
      } else {
        outcome = "pr_opened";
        lines.push(`Pushed ${branch} to origin and opened a pull request against ${base}: ${url}`);
      }
    }
  }
  lines.push("", "Tell the user the define workflow is finished and pass on the result above. Do not call next_step again.");
  logEvent(context, root, "finished", { change: name, sha, branch, base, outcome });
  return { text: lines.join("\n") };
}
