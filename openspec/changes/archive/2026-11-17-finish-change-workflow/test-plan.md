## Coverage Strategy

Specifications remain the source of unit-test requirements. This plan records only additional
integration and end-to-end obligations, the acceptance testing envelope, and exceptional human-only
obligations.

This change is for the Archon pack in `factory-workflows/archon/`, and builds on `add-validation`. Workflow paths below are relative to `factory-workflows/archon/.archon/workflows/codagent/`. Node names are the ones `design.md` gives.

The pack has two automated layers, and both run in the archon CI job:

- **bun tests** in `factory-workflows/archon/tests/*.test.ts`, run by `bun test tests/`. They build real temporary git repositories with `tests/helpers.ts`, with fake `archon`, `gh` and `openspec` commands.
- **Archon dry-run fixtures** in `implement-change/fixtures/`, run by `bun run test:fixtures` on the pinned Archon fork. Agent nodes are stubbed. In a fixture with `exec-code: true`, the scripts it does not stub run for real in a scratch worktree. A dry run does not evaluate `until_bash`, so a fixture reaches only a loop's first iteration.

Each risk goes to the cheapest layer that catches it:

- Routing is where a wrong `when:`, `trigger_rule` or report-mode check would skip the package, fail a run that should go on, or let a run go on that should fail. Fixtures cover each route.
- The completion loop's limits, a stalled pass, later CI cycles and the ranking's second check need loop iterations no dry run reaches. bun tests cover the scripts' side of them.
- The new modules' use of git, OpenSpec, the forge and the run's files is a real boundary. bun tests run them against a real repository with fake commands.
- Resume across many nodes, real providers' handling of the new output schemas, the real archive, forge and CI, and how the package reads in a real pull request need live agents. The acceptance pass covers them with a live trial.

The fixtures this change removes are `spec-driven.stubs.yaml`, `missing-validation-instruction.stubs.yaml` and `checklist-repair-blocked`, with their tests. Fixtures that stub `verify-assumptions-handoff` drop that stub.

## Integration Tests

### INT-001: A run that goes well ends with the package and outcome succeeded
- Covers: change-implementation "The change is reviewed after the session report" (Review follows the session report); "Verification is part of the implement workflow"; "A completion check decides whether the implementation is done" (Implementation is complete); "A separate reviewer audits by inspection"; change-archive "The change is archived after the acceptance rounds" (Archive runs after the rounds); draft-pull-request "The pull request stays a draft until finalize" (Finalize marks it ready); pull-request-finalization "The pull request is pushed and marked ready after the archive" (Finalize starts); "CI is awaited and fixed in up to three cycles" (CI passes); "The final head is checked once more" (Last report covers the final head); "The run ends in one of three states" (Succeeded); review-handoff "Every run whose acceptance rounds end writes a review package into its pull request"; "A decision log records what the definition did not settle" (Logs are committed before the archive).
- Boundary: the whole node order of `implement-change/implement-change.yaml`, with `publish-review-package` as the `returns:` node.
- Setup: the existing `happy-path.stubs.yaml`, updated. `check-completion` reports complete with no judge, `audit` and the review find nothing, the first acceptance round is ready, and the archive, finalize and ranking scripts pass. `judge-completion`, `continue-implementation`, `verify-assumptions-handoff` and every repair have no stub.
- Action: `archon workflow test` through `bun run test:fixtures`.
- Assertions: the simulation completes with authored outcome succeeded. It reaches `check-completion`, `check-completion-verdict`, `audit`, `session-report`, `prepare-review`, `write-acceptance-status`, `commit-logs`, `archive-change`, `verify-archive-commit`, `record-archive`, `finalize-push`, `mark-ready`, `wait-finalize-ci`, `ci-cycle-status`, `final-ci`, `record-finalize`, `prepare-ranking`, `rank-review`, `check-ranking` and `publish-review-package`. A node with no stub that runs fails the fixture.
- Execution: `implement-change/fixtures/`, CI archon job.

### INT-002: The judge's verdict routes the completion loop
- Covers: change-implementation "A judge decides why the implementation is not complete" (Only a person can unblock the work, Work remains, Record is incomplete, Only reasoned gaps remain); "A completion check decides whether the implementation is done" (Implementation is not complete); "The implement turn ends with a record" (Implementor is blocked); "A recorded block stops the run".
- Boundary: the `complete-implementation` loop's first iteration, with `continue-implementation` resuming `implement`.
- Setup: one new fixture per verdict. `check-completion` reports not complete with `judge` true, and `judge-completion` returns `continue` with a `remaining`, `fix-record`, `complete`, or `blocked`. A fifth fixture has `implement` return `blocked: true`.
- Action: `archon workflow test`.
- Assertions:
  - `continue` reaches `continue-implementation`, and the `remaining` text reaches its resolved instructions;
  - `fix-record` does not reach `continue-implementation`, and the iteration ends with the loop not done, so the completion check runs again (INT-007 covers that next check);
  - `complete` with reasoned gaps reaches `audit` with no continue pass;
  - `blocked`, and an implementor that returns `blocked`, fail the run at the completion loop, and no node after it runs.
- Execution: `implement-change/fixtures/`, CI archon job.

### INT-003: Archive repairs run once each
- Covers: change-archive "A failed archive transition gets one delta repair" (Delta no longer matches the current spec); "A check verifies the archive commit, with one repair" (Commit is wrong, Commit is verified).
- Boundary: the archive nodes, with `repair-archive-delta` and `repair-archive-commit` resuming `session-report`.
- Setup: two new fixtures. In one, `archive-change` reports a failed transition, `repair-archive-delta` fixes the delta and `rearchive-change` passes. In the other, `verify-archive-commit` fails, `repair-archive-commit` fixes it and `recheck-archive-commit` passes.
- Action: `archon workflow test`.
- Assertions: each reaches its repair and recheck once, then `record-archive` and `finalize-push`, and completes. `repair-archive-commit` does not run in the first, nor `repair-archive-delta` in the second.
- Execution: `implement-change/fixtures/`, CI archon job.

### INT-004: Failures after the rounds are reported, and earlier ones still fail the run
- Covers: pack-settings-and-run-files "A failed step after the acceptance rounds does not stop the run" (Archive check fails after its repair, Finalize repair is blocked, Acceptance push still fails, Acceptance fix is blocked, Check before the acceptance rounds); acceptance-rounds "The rounds record whether acceptance converged" (Did not converge); change-archive "A failed archive does not stop the run"; draft-pull-request "The pull request stays a draft until finalize" (Forge refuses to mark it ready); pull-request-finalization "A failed finalize does not stop the run"; "The run ends in one of three states" (Needs attention); review-handoff "A decision log records what the definition did not settle" (Log commit fails); "Every run whose acceptance rounds end writes a review package into its pull request" (Run ends after a failed step).
- Boundary: `check.ts` in report mode, the two acceptance nodes that end the rounds, and the `trigger_rule` of each node after a step that can fail.
- Setup: new fixtures, one per failure: the log commit fails; the archive still fails after its delta repair; the archive commit check still fails after its repair; the forge refuses `pr.ready`; a finalize repair returns `blocked: true`; acceptance does not converge while the archive and finalize pass; `acceptance-fix` returns `blocked: true`. The existing `push-repair-blocked` fixture, moved by add-validation, now expects the run to go on. The existing fixtures that fail a check before the pull request keep their stubs.
- Action: `archon workflow test`.
- Assertions:
  - each new fixture, except the failed log commit, completes with authored outcome failed and reaches `publish-review-package`;
  - the failed log commit reaches `archive-change` and completes with authored outcome succeeded;
  - a blocked acceptance fix and a push that still fails reach no later round's nodes, and reach `write-acceptance-status`, `commit-logs`, `archive-change`, `finalize-push` and `publish-review-package`;
  - after a failed archive, the finalize nodes still run;
  - after a refused `pr.ready` or a blocked finalize repair, `record-finalize` and the package nodes still run;
  - the existing fixtures that fail a check before the pull request still expect the run to fail at that check.
- Execution: `implement-change/fixtures/`, CI archon job.

### INT-005: Finalize's CI cycle routes
- Covers: pull-request-finalization "CI is awaited and fixed in up to three cycles" (CI fails or comments need action, CI is still running); "A CI wait that cannot run gets one repair" (Wait cannot reach the pull request, Only a person can fix the wait); "Finalize fixes stay within the approved scope"; "The final head is checked once more" (Head moved after the last report).
- Boundary: the `ci-cycles` loop's first iteration and `final-ci`, with `fix-pr` and the wait repairs resuming `session-report`.
- Setup: new fixtures. In one, `wait-finalize-ci` reports `failed` and `ci-cycle-status` outputs `fix`. In another, the wait reports `status: error`, and `repair-ci-wait` pushes a fix. In a third, `repair-ci-wait` returns `blocked: true`.
- Action: `archon workflow test`.
- Assertions:
  - a failed CI reaches `fix-pr`, and the CI report and the change folder from `record-archive` reach its resolved instructions; then `push-ci-fix` runs;
  - a wait error reaches `repair-ci-wait`, `mark-ready-after-repair` and `rewait-finalize-ci`;
  - a blocked wait repair stops the cycles, and the run reaches `record-finalize` and `publish-review-package` and completes with authored outcome failed.
- Execution: `implement-change/fixtures/`, CI archon job.

### INT-006: The ranking's repair, placement, and a package that cannot be written
- Covers: review-handoff "A script checks the ranking" (Ranking leaves out a required item, Ranking is still wrong after its repair); "Every run whose acceptance rounds end writes a review package into its pull request" (Package cannot be written); pull-request-finalization "The run ends in one of three states" (Failed).
- Boundary: the package nodes, with `repair-ranking` resuming `rank-review`.
- Setup: new fixtures. In one, `check-ranking` fails, `repair-ranking` fixes the ranking and `recheck-ranking` passes. In another, `recheck-ranking` also fails. In a third, `publish-review-package` fails.
- Action: `archon workflow test`.
- Assertions: the first reaches `repair-ranking` and `recheck-ranking` but not `place-ranking`, and completes. The second reaches `place-ranking` and `publish-review-package`, and completes. The third fails at `publish-review-package`.
- Execution: `implement-change/fixtures/`, CI archon job.

### INT-007: The completion scripts work against a real repository
- Covers: change-implementation "A completion check decides whether the implementation is done" (Implementation is complete, Implementation is not complete, Judge commits do not count); "The completion loop is bounded" (Continue passes run out, Record cannot be fixed, Continue pass makes no progress, Verdict is invalid); "A judge decides why the implementation is not complete"; pack-settings-and-run-files "Agents and scripts share named run files" (Completion verdict is recorded).
- Boundary: `.shared/lib/completion.ts` through `check-completion`, `check-completion-verdict` and `save-implementor-response`, calling git and reading and writing the run's files.
- Setup: a temporary git repository with a checklist, commits since the start (one starting with `[judge-completion]`), and a temporary artifacts folder. Cases ported from Runner's `completion_loop_scripts_test.go` and `completion_resume_test.go` at `01512940`.
- Action: run the scripts as bun child processes with the input environment and `ARTIFACTS_DIR` set as Archon sets them, in sequences that stand in for later loop iterations.
- Assertions:
  - each script prints one JSON document that matches its node's schema;
  - the check reports each problem Runner's check reports, and does not count a `[judge-completion]` commit;
  - a continue pass with no new commit and no changed row fails the run;
  - a fourth continue pass, a third `fix-record` in a row, `continue` with no `remaining`, `complete` with an unverified row that has no reason, and `blocked` with no `implementation-blocked.md` each fail;
  - `completion-loop.jsonl` gains one line per verdict, and a resumed run keeps a verdict already in `completion-verdict.json`.
- Constraints: plain git only, no network.
- Execution: `factory-workflows/archon/tests/`, `bun test tests/`, CI archon job.

### INT-008: The archive scripts work against a real repository
- Covers: change-archive "Exactly one archive folder exists for the change" (Archive folder is missing or doubled); "The change is archived after the acceptance rounds" (Change is already archived); "The archive commit holds only the archive's paths" (Archive is committed, Other work is in the worktree); "A check verifies the archive commit, with one repair" (Commit is verified, Commit is wrong); "A failed archive does not stop the run".
- Boundary: `.shared/lib/archive.ts` through `archive-change`, `verify-archive-commit` and `record-archive`, calling git and the fake `openspec`.
- Setup: a temporary git repository with an OpenSpec change folder, main specs, and other work staged and unstaged. The fake `openspec` moves the folder and updates the main specs as OpenSpec 1.17.0 does, or fails.
- Action: run the scripts as bun child processes.
- Assertions:
  - the commit holds the active folder's removal, the archive folder and the changed main specs, and leaves the other work as it was;
  - the message is Runner's default, in the ticket form for a ticket-prefixed name;
  - with the active folder gone and one archive folder present, it is reused; none, or two, are reported;
  - the commit check passes a correct commit and reports a wrong one;
  - `record-archive` writes the result to `step-results.json` with the paths left behind after a failure, and outputs the archive folder whenever the transition moved the change, even when its commit then failed, and the active folder otherwise.
- Constraints: plain git only, no network.
- Execution: `factory-workflows/archon/tests/`, `bun test tests/`, CI archon job.

### INT-009: The logs are written, numbered and committed
- Covers: change-review "Findings that were not fixed go to the logs"; "A later cycle does not reopen recorded findings"; review-handoff "A decision log records what the definition did not settle" (Agents agree not to fix a defect, Logs are committed before the archive, Log commit fails); "A dispute log records what the agents left unfixed without agreement" (Finding stays disputed, Nothing is disputed); pack-settings-and-run-files "Agents and scripts share named run files" (Decision is recorded, Dispute is recorded).
- Boundary: `.shared/lib/logs.ts` through `hand-off-review`, `hand-off-round-review` and `commit-logs`, with add-validation's `review/state.json`.
- Setup: a temporary git repository with a change folder and other uncommitted work, and an artifacts folder holding a review state with findings in every state and log sections the agents wrote.
- Action: run the hand-offs and `commit-logs` as bun child processes; run `commit-logs` again with a commit hook that rejects it.
- Assertions:
  - a `high` or `medium` finding closed by an accepted decline or reply goes to the decision log with the fixer's reason;
  - one not closed goes to the dispute log, with both sides when contested or disputed;
  - a `low` finding goes to neither, and a second hand-off adds nothing;
  - the committed logs number their sections `D-01` and `DP-01` on, and a log with no sections says `No entries.`;
  - the commit holds only the two logs, with the pack's message;
  - a rejected commit is recorded in `step-results.json` and the script exits as report mode does.
- Constraints: plain git only, no network.
- Execution: `factory-workflows/archon/tests/`, `bun test tests/`, CI archon job.

### INT-010: CI cycles and finalize's result read the forge correctly
- Covers: pull-request-finalization "CI is awaited and fixed in up to three cycles" (CI passes, CI fails or comments need action, CI is still running, Cycles run out); "The final head is checked once more"; "Finalize passes only on a clean final head" (Final head is clean, Final head is not clean, No CI is configured).
- Boundary: `.shared/lib/ci.ts` through `ci-cycle-status`, `final-ci` and `record-finalize`, with the fake `archon` printing forge envelopes.
- Setup: a temporary git repository on a branch, CI reports in the artifacts folder, and forge envelopes for checks, reviews, merge state and comments. Cases ported from Runner's `ci_status_gate_test.go` and `finalize_pr_ci_wait_test.go` at `01512940`.
- Action: run the scripts as bun child processes in sequences that stand in for three cycles.
- Assertions:
  - the gate stops on `passed` and on a blocked repair or `fix-pr`, outputs `fix` on `failed` or `comments`, and waits again on `pending`;
  - after three cycles the loop's exit condition holds and finalize records the failure;
  - `final-ci` reuses a settled report for the final head and waits again when the head moved;
  - `record-finalize` passes only when every check passed or none is configured, no review blocks, there is no conflict and no comment is left, and otherwise says what blocks the merge.
- Constraints: no network; a test that calls the real `archon` or `gh` fails.
- Execution: `factory-workflows/archon/tests/ci.test.ts`, `bun test tests/`, CI archon job.

### INT-011: The review package is checked, placed and rendered into the description
- Covers: review-handoff "The testing evidence is summarized for the person" (Commits follow acceptance, Commits touch only the change folder); "Every item is ranked in one tier" (Red items, Orange items); "Each item has a type"; "Each failed step is a red item" (Finalize failed); "A script checks the ranking" (Ranking leaves out a required item, Ranking is still wrong after its repair, Ranking agent's judgment); "'Review first' leads the pull request description" (Section content, Item prefix, Collapsed sections); "Items link to where they show" (Item cites a committed file, Item cites a run file); draft-pull-request "The review package rewrites the generated description" (Package is written, Person added text); pull-request-finalization "The run ends in one of three states" (Succeeded, Needs attention).
- Boundary: `.shared/lib/review-package.ts` through `prepare-ranking`, `check-ranking`, `place-ranking` and `publish-review-package`, calling git and the fake `archon forge pr.edit-body` and body read.
- Setup: a temporary git repository with commits before and after the accepted head, some changing only `openspec/`; an artifacts folder with a checklist, round status files, committed logs, `step-results.json` and rankings that pass and that break each rule.
- Action: run the scripts as bun child processes.
- Assertions:
  - the accepted head is the last `READY <sha>`, else the last tested revision, else the head when the pull request opened;
  - later commits leave out those that change only `openspec/`;
  - the check rejects a ranking that leaves out or ranks lower a failed or unverified row, a dispute other than a pull request comment, or a later commit, and one with an item in two tiers, an empty item or an unknown type; it does not force a pull request comment's tier;
  - placement puts each required item in its tier and adds `Tests: none named.` where it added a commit;
  - a red Failure item is added for each failure in `step-results.json` and for `ACCEPTANCE_FAILED`; for a blocked acceptance fix it names the decision-log entry, and for a push that still failed it says the round's fix may be missing from the pull request;
  - an entry an agent added to a committed log after the log commit is in the package;
  - the description has "Review first" with the run's state, every red item, at most five orange items with later commits first and a count of the rest, each item starting with its type; then the summary; then the collapsed sections;
  - text outside the markers is kept, a read-back that differs fails, and links to committed files are permalinks at the final head;
  - the outcome is succeeded only when acceptance converged and the archive and finalize passed.
- Constraints: no network.
- Execution: `factory-workflows/archon/tests/`, `bun test tests/`, CI archon job.

### INT-012: The forge marks the pull request ready, and pushes name what they pushed
- Covers: draft-pull-request "The pull request stays a draft until finalize" (Acceptance rounds, Finalize marks it ready, Forge refuses to mark it ready); pull-request-finalization "The pull request is pushed and marked ready after the archive" (Push still fails); "The run never merges the pull request".
- Boundary: `forge.ts` and `pull-request.ts` calling the fake `archon forge` and git.
- Setup: a temporary repository with a bare remote, and forge envelopes that accept and refuse `pr.ready`.
- Action: call `markReady`, the push that names what it pushed, and `check-forge`.
- Assertions: `markReady` calls `pr.ready` and reports a refusal with the forge's reason; `check-forge` fails when `pr.ready` is unavailable; a failed push names what it pushed; no call merges.
- Constraints: no network.
- Execution: `factory-workflows/archon/tests/pull-request.test.ts`, `bun test tests/`, CI archon job.

### INT-013: Comments by the pull request's author count, and the run's replies do not
- Covers: draft-pull-request "Unresolved threads and human comments are actionable feedback" (Thread answered by the author, Author's top-level comment, Thread answered by the run, Run's own top-level comment, Bot comment).
- Boundary: `.shared/lib/ci-comments.ts` classifying GitHub's GraphQL reply, as the acceptance rounds' wait and finalize read it.
- Setup: GraphQL replies with threads and top-level comments from the pull request's author, from another person and from bots, some ending with `<!-- codagent-reply -->`.
- Action: classify each reply, as the existing cases in `ci-comments.test.ts` do.
- Assertions: the author's comments and threads the author answered last count as feedback; a thread whose latest significant comment carries the marker is deferred; a top-level comment with the marker is left out; bot comments are informational, and the finding bot's trailing acks are still dropped.
- Constraints: no network.
- Execution: `factory-workflows/archon/tests/ci-comments.test.ts`, `bun test tests/`, CI archon job.

## End-to-End Tests

None. No automated test in this repository runs live agents or a forge, and none will run an entire workflow with live agents. Whether models follow the new instructions well is measured by evaluation runs, outside this repository. The dry-run fixtures are the highest automated layer, and the acceptance pass's live trial covers this change's live risks.

## Acceptance Testing Envelope

- Environments and sandboxes:
  - the run's worktree of the repository, with bun 1.4.4 and the pack's dev tools, through `bun run lint`, `bun test tests/` and `bun run test:fixtures`;
  - Archon from the local fork checkout, at the commit CI pins or the one the launcher uses: `archon validate workflows`, `archon workflow test`, and dry runs, including `--exec-code` dry runs, on scratch git repositories with a throwaway `ARCHON_HOME`, as `tests/run-fixtures.ts` does;
  - live trials with `bun run live-trial` on `pacaplan/archon-live-trial` (README.md, Live trials), from this change's checkout of the pack. To reach a path the stock change does not, the pass may commit another change folder on a local branch of the trial's clone and pass `--change` and `--from`.
- Credentials and secrets: the GitHub login and the provider logins already set up on the Mac, used only through `bun run live-trial`, Archon and `gh`. The pass never reads or prints them.
- Authorized effects:
  - local files under the run's worktree, its artifacts folder, temporary directories and the trial's clone at `~/.agent-workflows/live-trial/archon-live-trial`; temporary files are removed when done;
  - live trials, as many as the pass judges needed, for example after a harness failure or to reach a path an earlier trial missed. Each spends usage on every role's provider, opens a public pull request on the trial repository, and lets the run mark it ready, wait on its CI, push fixes and rewrite its description;
  - review comments on a line of code in a trial's own pull request, posted with `gh`, so finalize's `fix-pr`, its marked replies and its dispute entries run. A top-level comment cannot be resolved and would leave finalize failed;
  - cleanup of every trial with `bun run live-trial cleanup <branch>` once its run stops, after saving the run's state, files and the pull request description in the pass's report.
- Off limits:
  - the factory, its LaunchAgent, its state database and its private folder;
  - any paused or running evaluation run;
  - the user's global Archon home and config, which the pass may read to check that every role alias the pack uses is bound, and must not change;
  - the Archon fork checkout;
  - Chrome or server processes another session started;
  - pushes, branches, comments or pull requests on any repository other than the trial repository, and merging any pull request;
  - a live launch of `codagent-implement-change` outside `bun run live-trial`.
- Permitted substitutes: stubbed agent outputs and executable dry runs in place of live agents; scratch git repositories in place of a real project; fake `archon`, `gh` and `openspec` commands in the bun tests.
- Known risk areas:
  - the `trigger_rule` of the nodes after a report-mode check, which could skip the package or fail the run;
  - report mode reaching a check before the acceptance rounds end;
  - resume of `session-report` by the archive, finalize and `fix-pr` repairs, and of `rank-review` by its repair;
  - each provider's strict-mode handling of the `judge-completion` and `rank-review` output schemas;
  - the comment classifier's change, which the acceptance rounds' CI wait also uses, and `fix-pr` leaving the marker off a reply;
  - the two acceptance nodes that now end the rounds instead of failing the run;
  - `openspec archive` on deltas that modify requirements, and the reuse case after a resumed run;
  - GitHub's limit on description length, now that the logs go in the description;
  - a project settings file that still sets a removed change-kind setting.
- Accepted limitations: dry runs reach only a loop's first iteration. The archive runs before the person's review, even when acceptance did not converge. Nothing finds a decision no agent recorded.

## Human-Only Testing

None.

## Coverage Map

| Requirement or journey | INT | E2E | HT |
| --- | --- | --- | --- |
| change-implementation: The implement turn ends with a record | INT-002 | — | — |
| change-implementation: A completion check decides whether the implementation is done | INT-001, INT-002, INT-007 | — | — |
| change-implementation: A judge decides why the implementation is not complete | INT-002, INT-007 | — | — |
| change-implementation: The completion loop is bounded | INT-007 | — | — |
| change-implementation: The change is reviewed after the session report | INT-001 | — | — |
| change-implementation: Verification is part of the implement workflow | INT-001 | — | — |
| change-implementation: A separate reviewer audits by inspection | INT-001 | — | — |
| change-implementation: A recorded block stops the run | INT-002 | — | — |
| change-review: Findings that were not fixed go to the logs | INT-009 | — | — |
| acceptance-rounds: The rounds record whether acceptance converged | INT-004 | — | — |
| change-review: A later cycle does not reopen recorded findings | INT-009 | — | — |
| change-archive: The change is archived after the acceptance rounds | INT-001, INT-008 | — | — |
| change-archive: Exactly one archive folder exists for the change | INT-008 | — | — |
| change-archive: A failed archive transition gets one delta repair | INT-003 | — | — |
| change-archive: The archive commit holds only the archive's paths | INT-008 | — | — |
| change-archive: A check verifies the archive commit, with one repair | INT-003, INT-008 | — | — |
| change-archive: A failed archive does not stop the run | INT-004, INT-008 | — | — |
| draft-pull-request: The pull request stays a draft until finalize | INT-001, INT-004, INT-012 | — | — |
| draft-pull-request: The review package rewrites the generated description | INT-011 | — | — |
| draft-pull-request: Unresolved threads and human comments are actionable feedback | INT-013 | — | — |
| pull-request-finalization: The pull request is pushed and marked ready after the archive | INT-001, INT-012 | — | — |
| pull-request-finalization: CI is awaited and fixed in up to three cycles | INT-001, INT-005, INT-010 | — | — |
| pull-request-finalization: Finalize fixes stay within the approved scope | INT-005 | — | — |
| pull-request-finalization: A CI wait that cannot run gets one repair | INT-005 | — | — |
| pull-request-finalization: The final head is checked once more | INT-001, INT-005, INT-010 | — | — |
| pull-request-finalization: Finalize passes only on a clean final head | INT-010 | — | — |
| pull-request-finalization: A failed finalize does not stop the run | INT-004 | — | — |
| pull-request-finalization: The run ends in one of three states | INT-001, INT-004, INT-006, INT-011 | — | — |
| pull-request-finalization: The run never merges the pull request | INT-012 | — | — |
| review-handoff: Every run whose acceptance rounds end writes a review package into its pull request | INT-001, INT-004, INT-006 | — | — |
| review-handoff: A decision log records what the definition did not settle | INT-001, INT-004, INT-009 | — | — |
| review-handoff: A dispute log records what the agents left unfixed without agreement | INT-009 | — | — |
| review-handoff: The testing evidence is summarized for the person | INT-011 | — | — |
| review-handoff: Every item is ranked in one tier | INT-011 | — | — |
| review-handoff: Each item has a type | INT-011 | — | — |
| review-handoff: Each failed step is a red item | INT-011 | — | — |
| review-handoff: A script checks the ranking | INT-006, INT-011 | — | — |
| review-handoff: "Review first" leads the pull request description | INT-011 | — | — |
| review-handoff: Items link to where they show | INT-011 | — | — |
| pack-settings-and-run-files: A failed step after the acceptance rounds does not stop the run | INT-004 | — | — |
| pack-settings-and-run-files: Agents and scripts share named run files | INT-007, INT-009 | — | — |
