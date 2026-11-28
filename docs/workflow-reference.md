---
title: Workflow reference
group: Reference
order: 1
description: The pack's three workflows, their steps and roles, checks and repair limits, the acceptance gate, run outcomes, and the files a run writes.
---

# Workflow reference

This page lists what the pack's workflows contain. For how to launch and follow a run, see [Implementing a change](implementing-a-change.md).

## The workflows

| Workflow | What it does |
|---|---|
| `codagent-implement-change` | The entry point. Implements an approved change definition end to end. |
| `codagent-check-definition` | Validates the definition, with up to three autonomous implementor repairs. `codagent-implement-change` includes it. |
| `codagent-commit-definition` | Commits the definition and requires a clean worktree. `codagent-implement-change` includes it. |

You launch only `codagent-implement-change`. The other two are building blocks and can't be launched on their own. Verification is part of the entry point: it can't be launched alone.

Every check is a TypeScript script run by bun. The agents read two shared documents from the pack: how the implementor works and tests, and how the checklist is written and evidenced.

## Steps and roles

| Step | Role | What it does |
|---|---|---|
| Validate inputs, check forge | Script | Refuses a bad launch before any agent spends. |
| Check and commit definition | Script, `@implementor` repairs | Validates the change and commits it. |
| Checklist | `@implementor` | Plans how each spec behavior will be verified, as `CHECK-n` rows. |
| Implement | `@implementor` | Builds and tests the change, recording evidence for each row. Continues the checklist session. |
| Completion loop | Script, `@tester` judges | Checks that the work is complete, and judges why it isn't. |
| Audit | `@reviewer` | A fresh session audits the work against the definition. |
| Resolve findings | `@implementor` | Fixes each finding, or holds that it isn't a violation. |
| Session report | `@implementor` | Reports assumptions, context gaps and unverified rows. |
| Code review | `@reviewer`, `@implementor` | Reviews the changed code and fixes, declines or replies, in up to three fix rounds. |
| Open draft pull request | `@implementor`, script | The implementor writes the title and description in a fresh session. A script pushes and opens the draft. |
| Acceptance rounds | `@tester`, `@implementor` | A fresh tester tries the change as a user. The implementor fixes. Each fix is reviewed before it is pushed. |
| Recheck unverified rows | `@implementor` | Reruns, once, the checks of rows still `not verified`. |
| Commit logs, archive | Script, `@implementor` repairs | Commits both logs, validates the OpenSpec change and archives it into the specs. |
| Finalize | Script, `@implementor` fixes | Pushes, marks the pull request ready, and fixes CI failures and review comments. |
| Rank and publish | `@reviewer`, script | Ranks what needs you, checks the ranking, and writes the review page. |
| Wait for you | Archon wait | Pauses until you answer. |
| Review round | Script, `@implementor`, `@reviewer`, `@tester` | On Send feedback: merges in the base branch, addresses each answer, reviews, pushes, retests, finalizes, and publishes the next page. |
| Merge | Script | On Merge, merges the pull request at the reviewed head. |

The implementor's steps, from the checklist through the archive and finalize repairs, continue one session. The pull request description is written in a fresh session.

## Checks and repairs

Every agent step is followed by script checks. The first asks whether the agent reported itself blocked. Then the step's own check runs.

- A failed check goes to one agent repair, then the same check runs again in strict mode and fails the run if the problem remains.
- The evidence checks allow two repairs, and the definition check three. A loop that runs out of repairs fails the run.
- A repair that can't proceed without a person returns `blocked`. The run then fails with `REPAIR_BLOCKED: <reason>`.
- After the acceptance rounds, a check that still fails no longer fails the run. It becomes a High concern on the review page and the run goes on.

### Completion loop

A script checks completeness after the implement step. If the work isn't complete, a fresh tester session judges why:

- `blocked`: the run stops.
- `continue`: work remains. The implementor continues. At most three times. A pass that adds no commit and changes no checklist row fails the run as stalled.
- `fix-record`: the record needs fixing. At most two in a row.
- `complete`: the judge agrees with the check.

An invalid verdict fails the run.

### Code review

The reviewer inspects changed code for quality, security and error-handling defects. It does not repeat the audit or review style. It starts fresh each cycle and keeps its session for re-reviews.

- Before the draft pull request: up to three fix rounds. Each acceptance fix gets one round before it is pushed.
- The implementor may commit a fix, decline with a reason, or reply to a contest. The reviewer confirms or rejects fixes, and accepts or contests declines. A second disagreement becomes a dispute.
- Findings never gate the run. Unfixed high and medium findings go to the dispute log with both sides. Accepted high and medium declines go to the decision log. Low findings stay in the review results.
- A review that can't produce valid structured output fails the run.
- A commit after the initial review and before the draft gets a review with no fix rounds.

### Pushes

Workflow pushes fetch and merge the remote branch first, and never force. Transient failures retry with backoff. A push that still fails after its repair fails the run, and no page is written. If a push ends the acceptance rounds, a later push retries it, so a resume can continue.

## The acceptance gate

Each round ends at a gate, a script that calls the round ready or not. It reports ready only when all four hold at the current head:

- the tester's status says `READY` and names the current head;
- the tested revision is the current head;
- the exploration log and the handoff exist and are not empty;
- no tracked file has uncommitted changes.

If the gate says not ready and a fix is possible, the implementor fixes and the next round tests the fix. The last round ends at the gate, so no fix goes untested.

| Timing | Value |
|---|---|
| Rounds | 3 by default, 10 at most (`acceptance_rounds`) |
| Tester | A fresh session each round, with the earlier rounds' evidence files |
| CI wait | Up to 15 minutes, 3 minutes when no check appears |
| CI poll | Every 30 seconds |

A fix that changed nothing and wrote no retest reason ends the rounds as not converged. A blocked fix also ends them, and the run goes on. A push that still fails after its repair ends them too. The push after the rounds then retries, and the run fails if that push fails as well.

## Run outcomes

| Outcome | When |
|---|---|
| Succeeded | You chose Merge and it merged, whatever the page's items were. Or, with the wait off, acceptance converged, the archive succeeded, finalize passed, and the page was written. |
| Needs attention | With the wait off and the page written, acceptance didn't converge, or the archive or finalize failed. The page lists each failure as a High concern, and the pull request description says the run needs attention. |
| Failed | A major blocker stopped the run before the page was written. See [Implementing a change](implementing-a-change.md#what-stops-a-run). An agent that fails outright in a review round also fails the run. Resuming continues that round. |

A run that stops after acceptance (`stop_after: acceptance`) succeeds exactly when acceptance converged.

## Files a run writes

Agents and scripts share files in the run's artifacts folder. The ones a person reads:

| File | What it holds |
|---|---|
| `review-page.html`, `review-page-round-<n>.html` | The latest review page, and each round's page. |
| `review-answers-round-<n>.json` | Your saved answer from a round's page. |
| `review-response-round-<n>.json` | The implementor's response to each answer. |
| `decision-log.md`, `dispute-log.md` | The run's decisions and disputes, before they are numbered and committed in the change folder. |
| `implementation-blocked.md` | The question only a person can answer. Its existence fails the next check. |
| `implementation-complete.md`, `session-report.md` | What the implementor completed, and its report. |
| `acceptance-handoff.md`, `acceptance-findings.md` | The tester's handoff and findings for each round. |
| `acceptance-commands/round-<n>/` | Command evidence from each round. |
| `acceptance-screenshots/round-<n>/` | Screenshots from each round. |
| `ci/` | CI reports for each wait. |
| `pull-request.json` | The pull request as last checked: URL, number, base, draft state and head. |
| `step-results.json`, `finalize-results.json` | Each step's outcome, blockers and what remains. |
| `evidence/` | Saved output each checklist row's evidence names. |
| `nodes/audit.md` | The audit's findings. |

The checklist is `checklist.md` in the change folder, committed with the change. A failed run's files stay in its artifacts folder for you to read.
