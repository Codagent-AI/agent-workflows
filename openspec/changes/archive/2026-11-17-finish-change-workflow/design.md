## Context

This change builds on `add-validation`, which folds the verification workflow into `codagent-implement-change`, removes `@lead`, adds `@reviewer` and its code review, and keeps the implementor in one session from `implementor-checklist` to its last acceptance repair. Read add-validation's `design.md` as merged to `main`, in `openspec/changes/add-validation/` or, once archived, its archive folder, first: its node names, its `review/state.json`, its `&implementor-result` output (`blocked`, `reason`, `actions`) and its resume rules are assumed here.

Resume, as add-validation relies on it, is the Codagent-AI Archon fork's: `context: { resume: X }` continues X's session in place, with the turns of every node it depends on that continued X, earlier loop iterations included. Naming a skipped node fails. A node whose output schema differs from the session's misses the prompt cache.

Sources, all pinned:

- Agent Runner at `01512940`: `workflows/core/implement-change-v2.0.yaml` (the `complete-implementation` loop), `workflows/openspec/archive-change-v1.0.yaml`, `workflows/core/finalize-pr-v1.0.yaml`, their scripts, and the Go tests `workflows/completion_loop_scripts_test.go`, `workflows/archive_test.go`, `workflows/ci_status_gate_test.go`, `workflows/finalize_pr_ci_wait_test.go` and `internal/runner/completion_resume_test.go`.
- The Agent Factory at `96a3daf`, `src/agent_factory/work_kinds/pull_request/workflow/`: the `classify` and `verify-classification` steps of `factory-feature-v1.0.yaml`, `verify-classification.py` and `annotate-pr.py`.
- Agent Skills at `9109c2db`: the "Fixer Subagent Prompt" of `skills/fix-pr/SKILL.md`.

`prompts.md`, in this change folder, holds the final text of every agent prompt this change adds or changes. Write the commands from it. This document names the node each prompt belongs to.

## Goals / Non-Goals

**Goals:**

- Port Runner's completion loop, archive and finalize into `codagent-implement-change`, keeping Runner's prompts and limits.
- End every run that opened its pull request with a review package in the pull request description, and keep the run going past a failed acceptance, archive or finalize.
- Keep two logs, `decision-log.md` and `dispute-log.md`, that the agents write as they work and that a script commits in the change folder.
- Move the audit to `@reviewer`, and remove the spec-driven change kind.

**Non-Goals:**

- The person's review, changes after it, and re-acceptance testing.
- Agent Validator steps, merging, and any change to Archon or the define-openspec-change plugin.

## Approach

### Node order

The nodes below are added to, or change in, add-validation's `implement-change.yaml`. Everything not named keeps add-validation's shape.

1. **Implementation.**
   - `implementor-checklist` (fresh) and `implement` (resumes it) as today. `implement` gains Runner's record ending.
   - `check-evidence` and the `evidence-repairs` loop before the audit are removed. The `complete-implementation` loop takes their place.
   - `audit` moves to `['@reviewer', large]`, fresh.
   - `resolve-findings`, the evidence check and repairs after it, the clean and commit checks, and `session-report` stay.
   - `verify-assumptions-handoff`, `repair-assumptions-handoff` and `recheck-assumptions-handoff` are removed. `prepare-review` depends on `session-report`.
2. **Review, pull request and acceptance rounds** as add-validation has them. `hand-off-review` and `hand-off-round-review` write to the run's logs instead of `acceptance-assumptions.md` (see Logs). A blocked acceptance fix and a push that still fails end the rounds instead of failing the run (see Going on past a failure). `write-acceptance-status` is no longer the `returns:` node.
3. **Recheck.** `list-unverified` (script), `recheck-unverified`, and `push-recheck` (script) when the run stops after acceptance. This runs before the stop point (see Recheck after acceptance).
4. **Logs.** `commit-logs` (script).
5. **Archive.** `archive-change`, `repair-archive-delta`, `rearchive-change`, `verify-archive-commit`, `repair-archive-commit`, `recheck-archive-commit`, `record-archive`.
6. **Finalize.** `finalize-push`, `repair-finalize-push`, `recheck-finalize-push`, `mark-ready`, the `ci-cycles` loop, `final-ci`, `repair-final-wait`, `mark-ready-after-final-repair`, `recheck-final-ci`, `record-finalize`.
7. **Package.** `prepare-ranking`, `rank-review`, `check-ranking`, `repair-ranking`, `recheck-ranking`, `place-ranking`, `publish-review-package` (the `returns:` node).

### Roles and sessions

| Node | Command | Model | Session |
| --- | --- | --- | --- |
| `continue-implementation` | `continue-implementation` | `['@implementor', large]` | resumes `implement` |
| `judge-completion` | `judge-completion` | `['@tester', medium]` | fresh |
| `audit` | `audit` | `['@reviewer', large]` | fresh |
| `repair-archive-delta` | `repair-archive-delta` | `['@implementor', large]` | resumes `session-report` |
| `repair-archive-commit` | `repair-archive-commit` | `['@implementor', large]` | resumes `session-report` |
| `repair-finalize-push`, `repair-ci-fix-push` | `repair-push` | `['@implementor', large]` | resumes `session-report` |
| `repair-ci-wait`, `repair-final-wait` | `repair-ci-wait` | `['@implementor', large]` | resumes `session-report` |
| `fix-pr` | `fix-pr` | `['@implementor', large]` | resumes `session-report` |
| `rank-review` | `rank-review` | `['@reviewer', medium]` | fresh |
| `repair-ranking` | `repair-ranking` | `['@reviewer', medium]` | resumes `rank-review` |

- Every implementor node returns `&implementor-result`, and its `blocked` is read by the check after it. `fix-pr` sets `blocked` when it stops for a blocker.
- `session-report` always runs, so resuming it brings in every implementor turn since, acceptance fixes included. In Runner these steps ran on the lead's one session; the implementor's session is the closest match, and the agent that made the change knows its decisions when it reconciles a delta.
- `judge-completion`, `audit` and `rank-review` start fresh, so their commands begin with the autonomy preamble, and their output shapes differ from the implementor's.
- `repair-acceptance-push` in the rounds keeps resuming `acceptance-fix`, and uses the `repair-push` command.

### Completion loop

`complete-implementation` is a `loop_group` with `max_iterations: 12`, as Runner's, failing when exhausted. Its `until_bash` reads `check-completion-verdict.output.done`. Each iteration:

1. **`check-completion`** (script). It fails the run when `implementation-blocked.md` exists or the previous pass returned `blocked: true` (`$LOOP_PREV.continue-implementation.output.blocked`, with `implement`'s on the first iteration). After a continue pass it compares `continue-snapshot.json` with the head and the checklist's rows, and fails the run when the pass added no commit and changed no row. Then it checks, as Runner's `check-implementation-complete.sh` does: the evidence check passes, `implementation-complete.md` exists and is not empty, a commit since the implementation started does not start with `[judge-completion]`, and every row is `verified`. It writes `completion-problems.txt` and `completion-check.json` (`passed`, `only_unverified_with_reason`), and outputs `complete` and `judge`.
2. **`judge-completion`**, when `judge` is true and `completion-verdict.json` holds no verdict for this judgment, so a resumed run keeps a verdict already given. Its output is `{verdict, reason, remaining}`.
3. **`check-completion-verdict`** (script, always runs). It ports `check-completion-verdict.sh`: a `blocked` verdict needs `implementation-blocked.md` and fails the run printing it; `continue` needs a non-empty `remaining`; `complete` needs `only_unverified_with_reason`; at most 3 continue passes and 2 `fix-record` verdicts in a row. It appends to `completion-loop.jsonl`, writes `completion-verdict.json`, `implementation-remaining.md` and `continue-snapshot.json`, and outputs `done`, `verdict` and `remaining`. A complete check sets `done` without a verdict.
4. **`continue-implementation`**, when the verdict is `continue`, with `remaining` as its input.

`save-implementor-response` (script) writes the node output of `implement`, and of each continue pass, to `implementor-response.md`, which the judge reads as untrusted.

### Recheck after acceptance

The review and acceptance fixes run only the unit tests they affect, and they mark a checklist row `not verified` when they change its code without rerunning its check. Agent Runner closed that gap with Agent Validator, which ran the project's full checks after each acceptance fix. The pack has no validator, and a project may have no CI, so without a recheck those rows stay unverified at the final head.

- **`list-unverified`** (script, after `write-acceptance-status`) outputs the IDs of the rows still `not verified`.
- **`recheck-unverified`** (`['@implementor', large]`, resumes `session-report`) runs only when there are any. It reruns each distinct check those rows name, integration and end-to-end tests included, with a 10-minute timeout per command, saves the output under `$ARTIFACTS_DIR/evidence/`, marks each row `verified`, `failed` or still `not verified` with its reason, and commits only the checklist with the `[recheck]` prefix. A failed check is not fixed here; it reaches the person as a red item. Its `blocked` result changes nothing, because a row it could not recheck stays `not verified` and is red, and a checklist it could not commit fails the next push check: `finalize-push` and its repair in a finished run, `push-recheck` after acceptance. An error in the agent node fails the run, as for the pack's other agent steps, and a resume picks it up.
- **`push-recheck`** (script) runs only with `stop_after: acceptance`, so the draft pull request and the evaluated branch end at the recheck's commit. A failed push is recorded as an acceptance failure and the run ends failed. In a finished run, `finalize-push` pushes the commit.

It runs before the stop point, so evals, which stop after acceptance, get the same evidence. The commit touches only the change folder, so the ranking does not count it as a late commit; a commit that changes anything else is one.

### Logs

- **During the run.** The implementor, the auditor and the tester append decisions to `$ARTIFACTS_DIR/decision-log.md` as `## ` sections. `resolve-findings` appends each audit finding the implementor does not fix to `$ARTIFACTS_DIR/dispute-log.md`. `hand-off-review` keeps add-validation's selection, marking and section format, and writes each accepted decline or reply to the decision log and each `high` or `medium` finding that is not closed to the dispute log. The logs stay in the run folder because the checklist step and the tester may not change tracked files.
- **`commit-logs`**, after `write-acceptance-status`. It numbers the sections, `## D-01: <heading>` in the decision log and `## DP-01: <heading>` in the dispute log, writes both to `openspec/changes/<name>/`, writes `No entries.` in a log with none, and commits only those two files with `[logs] chore: add the decision and dispute logs for <name>`, or the ticket form `commit-plan.ts` uses. When the commit fails it prints the problem and the run goes on; the archive moves the files and its commit takes them along, so a failed log commit is not a failed step. Committing before the archive means the archive keeps the logs and finalize's CI covers the commit.
- **After the commit**, the committed logs are the logs. `repair-archive-delta` adds each decision it makes to `decision-log.md` in the active change folder, numbered after the last entry, and the archive commit takes it along. In finalize, `fix-pr` appends each review comment it does not fix to the committed `dispute-log.md` in `change_folder`, as `## DP-nn: PR comment: <words>`, and each decision it makes to the committed `decision-log.md` the same way, and commits them with its fixes. Its reply on the pull request stays, as in Runner, and ends with the marker `<!-- codagent-reply -->` (see Finalize). The other repairs after the commit only commit, push or diagnose, so their prompts do not mention the logs.

### Archive

- **`archive-change`** (script, report mode). When the active folder is gone and exactly one `openspec/changes/archive/*-<name>` folder exists, it reuses it. Otherwise it records the staged and unstaged paths, runs `openspec validate --type change <name>` and `openspec archive <name> --yes`, and commits the active folder's removal, the archive folder and the main specs the archive changed, with Runner's default message: `<TICKET>: Archive change` for a ticket-prefixed name, else `[archive] chore: archive openspec documents for <name>`. It writes `archive/state.json` with `archive_dir`, `owned_delta`, the start head and the paths recorded before.
- **`repair-archive-delta`**, when the transition failed, then **`rearchive-change`** runs the same script once more.
- **`verify-archive-commit`** (script, report mode), when the transition succeeded, ports Runner's commit check. **`repair-archive-commit`** runs when it fails, then **`recheck-archive-commit`**. The repair runs only when the script's commit is wrong, for example because a hook rejected its message. Runner's script never committed, so its repair made the commit on every run.
- **`record-archive`** (script, `trigger_rule: all_done`) writes the archive's result to `step-results.json`, with the paths left behind when it failed, and outputs `change_folder`: where the change folder is in the worktree, the archive folder whenever the transition moved it, even when its commit then failed, else `openspec/changes/<name>`. `fix-pr` and the ranking read the logs there.

### Finalize

- **`finalize-push`** (script, report mode) pushes without force, generalizing `acceptancePush`. `repair-finalize-push` runs `repair-push` with `pushed` set to "the logs and the archive".
- **`mark-ready`** (script, report mode) calls `archon forge pr.ready`. `check-forge` checks `pr.ready` at the start of the run. A refusal fails finalize, and the run goes on to the package.
- **`ci-cycles`**, a `loop_group` with `max_iterations: 3` that completes when exhausted:
  - `wait-finalize-ci` runs `wait-ci` with `max_minutes: 15` and `interval_seconds: 30`, as an acceptance round does, writing `ci/finalize-<n>.md`.
  - On `status: error`: `repair-ci-wait`, then `mark-ready-after-repair` (the agent only pushes), then `rewait-finalize-ci`.
  - `ci-cycle-status` (script) ports Runner's `ci-status-gate`: it stops on `passed`, stops on a blocked repair or `fix-pr`, outputs `fix` on `failed` or `comments`, and waits again on `pending`.
  - The comments come from `.shared/lib/ci-comments.ts`, which the acceptance rounds' wait also uses. It no longer drops the pull request author's top-level comments or defers a thread because its author answered last: the run opens the pull request with the user's login, so those are the user's comments. Instead it leaves out comments that end with `<!-- codagent-reply -->`, the marker `fix-pr` puts on its replies, and defers a thread whose latest significant comment carries it. The bot rules stay.
  - `fix-pr`, when `fix` is true, gets the report's text as `ci_report` and `record-archive`'s `change_folder`.
  - `push-ci-fix` (script), then `repair-ci-fix-push` with `pushed` set to "the CI fixes", and a recheck.
- **`final-ci`** (script) ports `ci-reuse-report.sh`: it reuses the last cycle's report when it is for the final head and settled, and otherwise waits once more into `ci/final.md`. `repair-final-wait`, `mark-ready-after-final-repair` and `recheck-final-ci` follow on an error.
- **`record-finalize`** (script, `trigger_rule: all_done`) passes finalize only when every check on the final head passed or none is configured, `pr.reviews` shows no blocking review, `pr.merge-state` shows no conflict, and no comment is left to act on. It writes the result to `step-results.json`, saying what blocks the merge.

### Package

- **`prepare-ranking`** (script) finds the accepted head: the last round's `READY <sha>`, else the last tested revision, else the head when the pull request opened. It lists the commits after it, leaving out those that change only `openspec/`, and passes them with `change_folder` to `rank-review`.
- **`rank-review`** outputs `red`, `orange`, `yellow` and `white` arrays of `{type, title, detail, link, source}`, and `evidence`, the testing evidence summary in Markdown.
- **`check-ranking`** (script, report mode) ports `verify-classification.py` and extends it. It builds the required items from files the ranker does not write: the checklist's failed and `not verified` rows (red), the dispute log's `DP` entries other than `PR comment` ones (at least orange), and the commits after the accepted head (at least orange, named by SHA, with the `--shortstat` size and a `Tests:` sentence). It rejects a ranking that leaves one out or ranks it lower, one tier per title, an empty item or an unknown type. A passing ranking is written to `review-attention.json`.
- **`repair-ranking`** once, then **`recheck-ranking`**. When the ranking still fails, **`place-ranking`** (script) starts from the last ranking and puts each required item in its tier itself, with `Tests: none named.` for later commits it had to add, so the package is still written.
- **`publish-review-package`** (script, `returns:`, `outcome_field: succeeded`) adds a red Failure item for each failure in `step-results.json` and for `ACCEPTANCE_FAILED`. It renders the description, ported from `annotate-pr.py`:
  - "Review first": the run's state (succeeded, or needs attention) and, when there are red items, how many block the merge ("Run succeeded. 1 red item blocks the merge."), every red item, then up to five orange items with the later commits first, then a line counting what is collapsed. Each item starts with its type, such as `Dispute:`.
  - The implementor's summary from `pr-body.md`.
  - Collapsed sections: the other orange and yellow items, the testing evidence with the white items, the decision log and the dispute log.

  It replaces only the generated block between the pack's markers through `archon forge pr.edit-body`, reads the body back, and saves `review-package.md`. Links to committed files are blob permalinks at the final head. A failure to write or read back fails the node, and so the run.

### Going on past a failure

In Archon any failed node fails the run. `check.ts` gains an `on_failure` binding, `fail` (the default) or `report`. In report mode, a check that still fails, or a repair that reports `blocked`, prints `ok: false` with its problems and exits 0. Every check from `commit-logs` on uses report mode, and the nodes after a step that can fail use `trigger_rule: all_done` or `none_failed_min_one_success`, so the archive, finalize and the package always run.

In the acceptance rounds, two nodes report instead of failing, and each ends the rounds: `check-acceptance-progress` when `acceptance-fix` returned `blocked: true`, and `recheck-acceptance-push` when the push still fails. Each records the failure in `step-results.json` and sets what the loop's `until_bash` reads, so no later round runs and the round's status stays not ready; `write-acceptance-status` then writes `ACCEPTANCE_FAILED`. The round's committed fixes reach the pull request through `finalize-push`. Before the rounds end, every other check that still fails after its repairs fails the run.

A run whose package is written completes, with outcome succeeded when acceptance converged and the archive and finalize passed, and failed otherwise.

### Shared code

- `.shared/lib/completion.ts`: the completion check, the progress snapshot, and the verdict check and ledger.
- `.shared/lib/archive.ts`: the transition, the reuse case, the commit and its check.
- `.shared/lib/ci.ts`: the cycle gate and the report reuse.
- `.shared/lib/ci-comments.ts`: the author filter replaced by the run's reply marker.
- `.shared/lib/logs.ts`: numbering, the hand-off sections and the commit of the logs.
- `.shared/lib/review-package.ts`: the accepted head and later commits, the ranking check and placement, and the rendering.
- `forge.ts` gains `pr.ready`, and `pull-request.ts` gains `markReady` and a push that names what it pushed.

### The spec-driven kind goes

Remove `change_kind`, `changes_root`, `change_label` and `artifact_validation_instruction` from `.pack/pack.yaml`, and their uses in `params.ts`, `validate-inputs`, `planning.ts` (`specDrivenProblems` and the kind check), `validate-definition.ts`, `commit-definition.ts`, `checklist.ts` and `complete-evidence.md` (the case of a change folder outside the repository), with the fixtures `spec-driven.stubs.yaml`, `missing-validation-instruction.stubs.yaml` and `checklist-repair-blocked`, and their tests. `$INPUTS.change_label` becomes the literal `OpenSpec change` in every command. The validation sentence agents get is derived from the change name.

## Decisions

- **The new steps go in `codagent-implement-change`**, because a node can resume only a node of its own workflow.
- **Two logs, written as agents work.** `implementor-decisions.md`, `acceptance-assumptions.md`, the assumptions handoff check and its repair are removed. Every agent records a decision in the decision log, and what was left unfixed without agreement goes to the dispute log. No agent collects or rewrites the logs; a script numbers and commits them.
- **The review hand-off keeps its place.** add-validation hands findings off at the end of each cycle; it now writes to the two logs. This keeps its marking, so a later cycle still does not reopen a handed-off finding.
- **Audit findings the implementor does not fix are disputes.** The audit runs once, so nothing else checks a decline.
- **Unfixed pull request comments are disputes, ranked by judgment.** The package must hold everything, so the person need not read the comment replies. The check does not force them to orange, so a style nit can be yellow.
- **The reviewer ranks, fresh, after finalize**, so it is independent of the implementation and sees finalize's commits. Its only guidance on what to surface is the Factory's tier rules.
- **A script makes the archive commit**, as the pack makes the definition commit; the implementor's repair runs only when the check fails.
- **`fix-pr` is copied from Agent Skills.** Runner's step only invoked the skill; its fixer prompt is the real instruction. `PROVENANCE.md` will say the pack is now the source of these instructions and Agent Skills is deprecated: skills already copied are never re-synced from it, and nothing reads it at run time. `fix-pr` is added to its table.
- **The run goes on past a blocked acceptance fix or a push that still fails.** An acceptance fix that needs the user's decision fixes what it safely can and records the decision; the package then brings the decision to the user. A push the repair cannot fix is retried by `finalize-push`. Neither is a major blocker once the pull request is open.
- **Entries after the log commit go to the committed logs**, so the archive keeps every decision and dispute and the package reads one copy.
- **The pull request author's comments count.** The Factory's PR author was its own account, so the wait-ci skill treated the author's comments as the agents' replies. Here the author is the user, and the run marks its own replies instead.
- **Commits that change only `openspec/` are not later commits.** They are the logs, the archive and recorded disputes, which the person reads in the package anyway.

## Risks / Trade-offs

- **The archive runs before the person's review**, even when acceptance failed. A change asked for afterwards edits the main specs, since OpenSpec cannot undo an archive.
- **The pull request is marked ready before a person looks at it.** "Review first" says what blocks the merge, and only a person merges.
- **The ranker could understate a risk.** The check covers the mechanical cases only.
- **An agent may not record a decision.** Nothing finds a decision no agent wrote down, as with the Factory's `decisions.md`.
- **It relies on the fork's resume.** On stock Archon each resume forks: nothing fails, but later steps do not see the earlier turns and miss the cache.
- **`fix-pr` changes comment threads with `gh api`**, as Runner did. The pack's rule that agents never change a pull request covers its state and description only.
- **Cost and time.** Judge turns, continue passes, the CI waits and the fix cycles all add to a run.
- **A top-level comment never counts as handled.** It cannot be resolved, so one still there after the CI cycles leaves finalize failed, and the user sees it as a red item. The user's own top-level comments count too. Comments on lines of code clear when `fix-pr` resolves the thread or replies.
- **A reply without the marker counts as a comment.** If `fix-pr` leaves it off, its reply brings it back in the next cycle, and at worst the cycles run out and finalize fails with a red item.
- **The run archives and finalizes before the user's pending decision**, when an acceptance fix stopped on one.
- **After a failed archive commit**, the archive folder may not be at the pull request's head, so a link into it may not open.

## Migration Plan

- Implement after `add-validation` merges, and archive after it: this change's deltas modify requirements that `add-validation` adds, so `openspec archive` refuses them until `add-validation` is archived.
- A project removes `@crosscheck` and any of the four change-kind settings from its config; Archon refuses a run whose settings file sets a key the pack does not declare.
- Update `factory-workflows/archon/README.md`, `PROVENANCE.md` (the new sources above, the Agent Skills note, that the pack dropped Runner's spec-driven kind, and that `ci-comments.ts` counts the pull request author's comments and leaves out the run's marked replies, unlike the wait-ci skill) and `AGENTS.md`.
- Rollback is a revert of the change's commits.

## Testing

- Bun tests for each new module, ported from Runner's Go tests and the Factory's checks, added to the existing suites under `tests/`.
- A dry-run fixture for each branch the first loop iteration reaches: complete on the first check; `continue`; `fix-record`; `complete` with reasoned gaps; `blocked`; archive success, delta repair and commit repair; a failed archive followed by finalize; a blocked acceptance fix and a push that still fails, each followed by the archive; finalize passing and failing; a wait repair; a refused `pr.ready`; a rejected, repaired and placed ranking; a package that cannot be written; the needs-attention outcome; and the preamble on every fresh node. The bun tests cover the loop limits, a stalled pass and later CI cycles.
- A live trial, with Paul's permission, as the test plan sets out.
