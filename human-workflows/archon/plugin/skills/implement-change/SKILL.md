---
name: implement-change
description: Implement an approved OpenSpec change with Archon, running the Codagent pack's codagent-implement-change workflow in an Archon-made worktree. Launches the run for a change on the default branch or another branch, waits in the background, tells the user when it stops, and on a failure investigates, fixes what is safe to fix, and resumes. Use when the user asks to implement a change using Archon, run Archon on a change, or have Archon build a change.
---

# Implement a change with Archon

Runs `codagent-implement-change` from the Codagent pack (`factory-workflows/archon` in a clone of `Codagent-AI/agent-workflows`) against one OpenSpec change, then reports.

For general Archon CLI use (run states, reading a run and its artifacts, answer forms, resume, end-turn, cancel versus abandon, logs, worktree cleanup), use Archon's `archon-cli` skill. This skill adds only what is specific to the pack. If `archon-cli` is not installed or `archon doctor` fails, point the user to the Setup page of the docs, https://github.com/Codagent-AI/agent-workflows/blob/main/docs/setup.md (`archon setup`, then `archon skill add`) before launching.

Never print tokens or read credential files.

## Inputs

- **Change name** (required): the folder name under `openspec/changes/`.
- **Repository**: a local checkout of the target repo. Default: the repo of the current directory. Use its main checkout (the parent of `git rev-parse --path-format=absolute --git-common-dir`) as the launch checkout.
- **Implementation branch**: default the change name. The user can name another.
- **Pack checkout**: a local clone of `Codagent-AI/agent-workflows`, on whatever branch it is, edits included. Use the current repository when it is that clone; otherwise ask the user where theirs is. The user can name another checkout, such as a worktree with a pack fix.

Where the run starts follows where the change is (step 1.2). Ask only if the change name or the pack checkout is missing, or more than one repo fits.

## 1. Preflight

Stop and tell the user at the first problem. Do not work around one by pushing, switching branches, or freeing a checkout yourself.

1. `git -C <main> fetch origin`. Find the default branch with `git -C <main> symbolic-ref --short refs/remotes/origin/HEAD`.
2. Find the change. The path is `openspec/changes/<name>/proposal.md`; the pack supports only OpenSpec changes there. Test each ref with `git -C <main> cat-file -e <ref>:<path>` and take the first that has it:
   1. `origin/<default>`: start from the remote default branch (no `--from`).
   2. Local `<default>`, not pushed: start from it with `--from <default>`.
   3. The local branch checked out where the user is working (`git -C <cwd> branch --show-current`): branch off it with `--from <that branch>`.
   4. None of these: ask the user where the change is.

   A worktree sees only commits, so if the change exists only as uncommitted files, ask the user to commit it. `--from` takes a local branch as is, pushed or not. The PR still targets the default branch, so it also carries any commits of that branch not yet on the default.
3. Note the pack checkout's branch, commit, and whether it has uncommitted edits (`git -C <pack> status --short`). `--workflow-source` runs the files as they are on disk, edits included, and Archon freezes them for the run when it starts. This is for the report, not a gate.
4. Check what else is working locally: the tester may drive a browser, and every agent needs memory. List other Archon runs with `archon workflow runs --all --status running --json` and the same for `pending` and `paused`. Ask the user before launching if one of them is doing local work: an agent or browser node in progress (see its nodes in `archon workflow get <id> --json --verbose`), or a pause for a person's answer, which starts local work again once answered. A run that only sleeps between polls of remote work, such as one waiting on remote machines or on its own sub-runs, does not count; name it in the launch report.
5. If the implementation branch already exists, check who holds it: `git -C <main> worktree list --porcelain`. A checkout outside Archon's workspaces (`~/.archon/workspaces`) that holds the branch makes Archon fail with `branch_checked_out`; tell the user which path holds it. An existing branch is reused at its head, never reset.
6. The role aliases resolve: `~/.archon/config.yaml` or the target's `.archon/config.yaml` binds `@implementor`, `@tester` and `@reviewer`. An unbound alias silently falls back to a tier default.

## 2. Launch

```sh
archon workflow run codagent-implement-change \
  --cwd <main> \
  --branch <implementation branch> \
  [--from <start branch>] \
  --workflow-source <pack>/factory-workflows/archon \
  --input change_name=<name> \
  --detach --json
```

- Pass `--from` as step 1.2 chose. Archon rejects `--from` for a branch that already exists; ask the user whether to reuse that branch at its head (drop `--from`) or pick another name. Without `--from`, a new worktree is cut from the remote default branch.
- The worktree lands in `~/.archon/workspaces/<owner>/<repo>/worktrees/<branch>`; the main checkout stays on its branch.
- Read `runId`, `transcriptPath` and `logPath` from the JSON acknowledgement. If the launch is refused, report the error; most refusals are preflight problems.

Tell the user in one or two lines: the change, the branch and its start point, the pack's branch and commit (and "with edits" if dirty), the run id, and that you will report when it stops.

## 3. Wait

Run `wait-run.sh`, in the folder that holds this file, in the background, with its record in a temporary folder:

```sh
<this skill's folder>/wait-run.sh <runId> <main> --out <temp folder>/archon-<runId>.json
```

In Claude Code, run it as a background Bash command; you are notified when it exits, so do not poll its output. On a CLI without background commands, run it in the foreground with the longest timeout the CLI allows, and run it again if that timeout ends first; the run is unaffected.

It keeps waiting while the run is pending, running, or parked on a provider usage limit, and costs no model time. It stops when the run ends, pauses for an answer, loses its owner, has a tool call silent for 30 minutes (`--stall-minutes`), or the wait fails three times. Default ceiling is 24 hours (`--max-hours`, exit 2). Its last lines give the status, authored outcome, reason and artifacts directory. It needs `archon` and `jq` on PATH.

## 4. Review page and run outcome

When the run pauses with an attention message beginning `Review round <n>:`, give the user the latest page URL, `<archon address>/api/artifacts/<run id>/review-page.html`. Use the address of the Archon server serving this run. If it is unavailable, give the run ID and file name so the user can open the artifact from Archon's UI or copy the run artifacts. Advise the user that the page sends feedback or merges, and the same wait can take a plain-text note or `merge` from Archon's CLI or UI. Leave the answer to the user. Follow the same run after the answer and give the user the same latest URL if it pauses again.

Check that the host which continues an answered run has bun, the forge and provider logins, and cloc for the optional size count. A continuation needs `archon serve` or `archon workflow wake`. If the page reports it cannot send, the CLI or UI can answer the wait.

For an existing change or PR, use the Archon CLI skill to list runs in the target repository and inspect the most recent runs of `codagent-implement-change`. Match the run's change input or the PR number and repository in its `pull-request.json` artifact. Verify it has `review-page.html` and give its fixed URL. Use the numbered page links in the PR if helpful to locate the run.

With `stop_after: acceptance`, report whether acceptance converged and the draft PR, and summarize any open findings from the handoff. With `review_wait: false`, report the outcome, PR and review page. On merge or external close, report the final state and the PR URL. Investigate any failed, lost or stalled run as described below.

## 5. A failed or stuck run

Find the cause before changing anything. For the run itself (its reason, the failed node, its logs, a stalled turn), follow the `archon-cli` skill's `operate/troubleshooting.md`, passing `--cwd <main>`; the child process log is the launch's `logPath`. The pack adds its own evidence:

- `implementation-blocked.md` and any `REPAIR_BLOCKED: <reason>` text: these are questions only a human can answer.
- For a check script, its `{ok, problems}` output, and `evidence-problems.txt`.
- For a stall, the stalled call's node, provider and tool in the wait result.

Then act by cause:

- **Environment or transient** (network, provider outage, a provider's login expired, `gh` auth, a missing tool such as `openspec`, a crashed process, a stall that `end-turn` can recover): fix what you can without secrets. For a login, ask the user to run it themselves (in Claude Code, `! codex login`, for example); never read or copy credential files. Then `archon workflow resume <runId> --cwd <main> --detach --json` and go back to step 3. Resume at most twice for the same cause; after that, report.
- **A human question** (`REPAIR_BLOCKED`, `implementation-blocked.md`, an attention wait other than the review page): put it to the user. Never answer it yourself. Ask the user how to proceed once they have answered; the pack has no input for a late answer, so it usually means updating the change and starting a new run.
- **The change's own work did not converge** (a strict recheck still failing after its repairs, the evidence repairs exhausted): report the problems. Do not edit or push the implementation branch yourself unless the user asks.
- **A pack defect** (a script or workflow bug in agent-workflows) or an **Archon defect**: describe the cause with the evidence and ask the user before fixing. Offer to file an issue on the repository that owns it.
  - An Archon fix reaches a resume when `archon` runs from a source checkout.
  - A fix to the code in the run's worktree reaches a resume.
  - A pack fix does not, yet: Archon freezes the workflow, commands and scripts when a run starts, and a resume refuses a changed copy. Tell the user, and ask whether to start a new run. A pack-developer opt-in to resume on edited source is requested upstream in coleam00/Archon#5605; check it before assuming this is still true.

For `owner_lost`: confirm the run's process is gone before doing anything (`archon-cli`, `operate/managing-runs.md`, "Cancel vs abandon"), and ask the user before `archon workflow abandon`.

## Do not

- Merge the PR or push to the implementation branch without the user asking. The run marks the PR ready itself; leave its state alone.
- Abandon or cancel a run, or remove its worktree, without the user's say.
- Clean up worktrees after a merge unless the user asks.
- Touch another session's runs, browsers or servers.
