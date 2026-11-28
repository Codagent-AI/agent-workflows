---
title: Implementing a change
group: Guides
order: 3
description: How to launch an implementation on Archon, what a run does stage by stage, what stops it, and what to do next.
---

# Implementing a change

Once a change is defined and committed, Archon implements it. The pack's `codagent-implement-change` workflow builds the change on its own branch in an isolated worktree, checks it, tests it as a user would, archives it, and opens a pull request. It never merges unless you choose Merge on the review page.

Set up Archon first. See [Setup](setup.md).

## Launch a run

### With the skill

In the repository that holds the change:

| CLI | Command |
|---|---|
| Claude Code | `/codagent-archon:implement-change <change-name>`, or ask to implement the change with Archon |
| Codex | `$implement-change <change-name>`, or ask to implement the change with Archon |

The change must be committed under `openspec/changes/<name>/`. A worktree sees only commits, so uncommitted files are not enough. The skill looks for the change on the remote default branch, then on your local default branch, then on the branch you have checked out, and asks where it is if none has it.

The skill then:

1. Checks the setup: that the role aliases resolve, that no other run is about to compete for your machine, and who holds the implementation branch.
2. Launches the run, on a branch named after the change unless you name another.
3. Waits in the background without using the model, and tells you when the run stops.
4. When the run waits for you, gives you the review page's address.
5. When a run fails, finds the cause. It fixes what is safe, such as an expired login you re-run yourself or a transient error, and resumes the run, at most twice for the same cause. For anything else it reports.

It never merges the pull request, never pushes to the implementation branch, and never abandons a run or removes a worktree without your say.

### With the command

The skill runs this for you. You can run it yourself:

```bash
archon workflow run codagent-implement-change \
  --cwd /path/to/target \
  --branch <implementation-branch> \
  --workflow-source /path/to/agent-workflows/factory-workflows/archon \
  --input change_name=<name> \
  --detach --json
```

`change_name` is the only input a launch must give. Everything else is a [pack setting](roles-and-settings.md#pack-settings).

- Archon makes the worktree under `~/.archon/workspaces/<owner>/<repo>/worktrees/<branch>`, cut from the remote default branch. Your checkout stays where it is. Add `--from <branch>` to start from another branch.
- With `--no-worktree` the run works in the target checkout's current branch, which becomes the pull request's branch.
- The pull request targets the default branch.

## What a run does

A run is a fixed sequence. Code decides the order, and a script checks each agent step before the next one starts. A check that fails gets one agent repair, then a strict recheck. See [Workflow reference](workflow-reference.md#checks-and-repairs).

1. **Check the inputs and the forge.** The change name and settings, and your access to the forge, before any agent spends.
2. **Check and commit the definition.** `openspec validate`, and non-empty proposal, specs, design and test plan. The implementor repairs problems, up to three times. The definition is committed, and the worktree must be clean.
3. **Write the checklist.** The implementor lists each spec behavior as a `CHECK-n` row, with how it will be verified: an automated test, a scripted command, or inspection. It does not plan any check where an agent operates the product as a user. That happens in acceptance.
4. **Implement.** The same implementor session builds the change, runs each check, and records its evidence and a status for each row: `verified`, `failed` or `not verified`.
5. **Completion loop.** A script checks that the work is complete. If it isn't, a fresh tester session decides why: blocked, work remains (the implementor continues, three times at most), the record needs fixing (twice in a row at most), or complete.
6. **Audit.** A fresh reviewer session audits the work against the definition by inspection. The implementor fixes each finding, or holds that it isn't a violation, which goes to the dispute log.
7. **Session report and clean checks.** The implementor reports its assumptions and anything unverified. The worktree must be clean and committed.
8. **Code review.** A reviewer checks the changed code for quality, security and error handling. The implementor fixes, declines or replies, for up to three fix rounds. With `review_strategy: none` this is skipped.
9. **Open the draft pull request.** The implementor writes the title and description in a fresh session, and a script pushes and opens the draft.
10. **Acceptance rounds.** A fresh tester tries the change as a user would, in rounds, until a round is ready or the rounds run out. CI is awaited in each round whose tester reports ready. An acceptance fix is reviewed before it is pushed.
11. **Recheck unverified rows.** The implementor reruns once the checks of the rows still `not verified`, in case later fixes changed the code. A check that still fails goes to you as a high concern.
12. **Archive and finalize.** The decision and dispute logs are committed. The OpenSpec change is archived into the living specs. The branch is pushed, the pull request is marked ready, and CI failures and review comments are fixed, in up to three cycles. This runs even if acceptance didn't converge.
13. **Rank and publish.** A fresh reviewer ranks what needs your call. A script checks the ranking and writes the review page.
14. **Wait for you.** The run pauses at the review page. See [Reviewing a run](reviewing-a-run.md).

With `stop_after: acceptance` the run ends after step 11, leaving the pull request a draft and the change unarchived.

## What the agents record

Agents never stop to ask you. When a point isn't settled by the definition, they decide it and write it in `decision-log.md`. When an agent and a reviewer can't agree, both sides go in `dispute-log.md`. Both logs are numbered and committed in the change folder, and they are archived with the change. The review page ranks their entries. See [Reviewing a run](reviewing-a-run.md#the-two-logs).

## What stops a run

A run fails, rather than waits, in these cases:

- the definition is still invalid after its repairs;
- the implementor is blocked on something only a person can settle. It writes `implementation-blocked.md`, and the next check fails the run;
- a repair cannot proceed without a person. The run fails with `REPAIR_BLOCKED: <reason>`;
- the completion loop reaches a limit, or stalls;
- a check before the pull request, or in the acceptance rounds, still fails after its repair;
- a push still fails after its repair;
- the review page can't be written, or the head it would show isn't the pull request's head on GitHub.

A failed step after the acceptance rounds does not fail the run. A failed acceptance, archive or finalize becomes a high concern on the review page, and the run goes on to the page. With `review_wait: false` it ends as needs attention. See [Workflow reference](workflow-reference.md#run-outcomes).

## What to do next

- **A question only you can answer.** The run has no input for a late answer. Update the change, commit it, and start a new run.
- **An environment problem**, such as a provider login that expired, a missing tool, or a network error. Fix it, then resume: `archon workflow resume <run-id> --cwd <checkout> --detach --json`. See [Troubleshooting](troubleshooting.md).
- **A defect in the pack.** Archon freezes the workflow when a run starts, and a resume refuses a changed copy. A pack fix reaches only a new run.
- **Work that didn't converge.** Read the problems, then decide: fix the change and start again, or fix the branch yourself.

Don't push to the implementation branch while a run is working on it.

## Where to look

Each run writes its files under its artifacts folder, which Archon shows in its web UI and in `archon workflow get <run-id> --json --verbose`. [Workflow reference](workflow-reference.md#files-a-run-writes) lists the ones a person reads.
