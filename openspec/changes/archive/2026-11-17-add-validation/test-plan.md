## Coverage Strategy

Specifications remain the source of unit-test requirements. This plan records only additional
integration and end-to-end obligations, the acceptance testing envelope, and exceptional human-only
obligations.

This change is for the Archon pack in `factory-workflows/archon/`. Workflow paths below are relative to `factory-workflows/archon/.archon/workflows/codagent/`.

The pack has two automated layers, and both run in the archon CI job:

- **bun tests** in `factory-workflows/archon/tests/*.test.ts`, run by `bun test tests/`. Some already build real temporary git repositories with `tests/helpers.ts`, and CI sets a git user for them.
- **Archon dry-run fixtures** in each workflow's `fixtures/` folder, run by `bun run test:fixtures` on the pinned Archon fork. Agent nodes are stubbed. In a fixture with `exec-code: true`, scripts run for real in a scratch worktree. A dry run does not evaluate `until_bash`, so a fixture reaches only a loop's first iteration.

Each risk goes to the cheapest layer that catches it:

- The finding states, contest-once, IDs, settling and the unchanged-fix stop are plain logic. Unit tests in `tests/review.test.ts` and `tests/acceptance.test.ts` cover them, including the second and third fix rounds that no dry run reaches.
- Routing through skipped review nodes is where a wrong `when:` or `trigger_rule` would skip the pull request or fail the run. Fixtures cover each route.
- The review scripts' use of git and of the run's files is a real boundary. A bun test runs them against a real repository.
- A real provider continuing a long session, and later fix rounds, need live agents. One manual run covers them before merge.

The verification fixtures that move to `implement-change/fixtures/` keep their current assertions, with the implement steps stubbed.

## Integration Tests

### INT-001: Review off skips every review step
- Covers: change-review "The review strategy picks the reviewer" (Review is off); change-implementation "The change is reviewed after the assumptions handoff check" (Review is off).
- Boundary: Archon evaluating `when:` and `trigger_rule` across the skipped review nodes in `implement-change/implement-change.yaml`.
- Setup: a new fixture with the implement steps stubbed, `review_strategy: none`, and no stub for any review node.
- Action: `archon workflow test` through `bun run test:fixtures`.
- Assertions: the simulation completes with authored outcome succeeded. It reaches `verify-assumptions-handoff`, `verify-clean-for-pr`, `open-draft-pr` and `write-acceptance-status`. A review node that runs fails the fixture, because it has no stub.
- Execution: `implement-change/fixtures/`, CI archon job.

### INT-002: A review with no findings goes straight to the clean check
- Covers: change-review "Every strategy returns the same findings shape" (Review finds nothing); change-implementation "The change is reviewed after the assumptions handoff check" (Review follows the handoff check); change-review "The review strategy picks the reviewer" (Default strategy, before the pull request).
- Boundary: the default route through the review nodes in the implement workflow.
- Setup: the existing `implement-change/fixtures/happy-path.stubs.yaml`, updated with the default strategy. `review-change` returns an empty findings list, and `record-review` reports the cycle settled. The fix loop's nodes have no stubs.
- Action: `archon workflow test`.
- Assertions: it reaches `verify-assumptions-handoff`, then `review-change`, `hand-off-review`, `verify-clean-for-pr` and `open-draft-pr`, and completes. No fix-loop node runs.
- Execution: `implement-change/fixtures/`, CI archon job.

### INT-003: A first fix round wires the fixer's and the reviewer's sessions
- Covers: change-review "The implementor fixes the findings in its own session" (Fixer before the pull request); "Each fix round is a fixer turn and a re-review"; "A review cycle keeps one reviewer session" (Re-review in the same cycle).
- Boundary: Archon loading resume sources across the loop boundary, where `fix-review-findings` resumes `session-report` and `re-review` resumes `review-change`, and running the loop body in order.
- Setup: a new fixture. `review-change` returns one finding. `record-review` reports the cycle not settled and passes on the finding's text with ID `R1`. The loop body's nodes are stubbed, and `end-review-round` reports stop.
- Action: `archon workflow test`.
- Assertions: the workflow loads. It reaches `fix-review-findings`, `record-review-fixes`, `re-review`, `end-review-round`, `hand-off-review` and `open-draft-pr`, and completes. The text of `R1` reaches the resolved instructions of `fix-review-findings`.
- Execution: `implement-change/fixtures/`, CI archon job.

### INT-004: A blocked fixer stops the rounds without failing the run
- Covers: change-review "Fix rounds are bounded" (Fixer is blocked); "Findings that were not fixed go to the assumptions record" (Findings remain before the pull request).
- Boundary: the skip of `re-review` inside the loop body, and the round's end and hand-off running after it.
- Setup: a new fixture in which `record-review-fixes` reports the fixer blocked. `re-review` has no stub.
- Action: `archon workflow test`.
- Assertions: `re-review` does not run. `end-review-round` and `hand-off-review` run, and the run reaches `open-draft-pr` and completes.
- Execution: `implement-change/fixtures/`, CI archon job.

### INT-005: A commit after the review is reviewed before the pull request
- Covers: change-review "The pull request's head is reviewed" (Repair commits after the review); "A review cycle keeps one reviewer session" (Commit after the review).
- Boundary: the tail nodes between `verify-clean-for-pr` and `open-draft-pr`, with `tail-review` in a fresh session.
- Setup: a new fixture in which `verify-clean-for-pr` fails, its repair commits, and `prepare-tail-review` reports a new range.
- Action: `archon workflow test`.
- Assertions: `tail-review`, then `record-tail-review`, then `open-draft-pr` run, and the run completes. No fix-loop node runs after the tail.
- Execution: `implement-change/fixtures/`, CI archon job.

### INT-006: An acceptance round reviews its fix with one fix round
- Covers: change-review "The review strategy picks the reviewer" (Default strategy, in an acceptance round with a fix); "The implementor fixes the findings in its own session" (Fixer in an acceptance round); "A review cycle keeps one reviewer session" (First review of a cycle, Next acceptance round); "Fix rounds are bounded" (Acceptance round has one fix round); "Findings that were not fixed go to the assumptions record" (Findings remain in an acceptance round); acceptance-rounds "An acceptance fix is reviewed before it is pushed" (Fix is reviewed, Last round).
- Boundary: the review nodes inside the `acceptance-rounds` body, with `fix-round-findings` resuming `acceptance-fix` and `round-re-review` resuming `round-review` in the same body, and `acceptance-push` running after the round's hand-off.
- Setup: a new fixture whose round has a fix with `push` true. `round-review` returns one finding, and the round's one fixer turn and re-review are stubbed. The moved `ready-first-round` fixture keeps a round with no fix and no review stubs.
- Action: `archon workflow test`.
- Assertions: the workflow loads. The round reaches `round-review`, `fix-round-findings`, `round-re-review`, `end-round-review`, `hand-off-round-review` and `acceptance-push`, and completes. No second fixer turn runs in the round. In `ready-first-round`, no round review node runs.
- Execution: `implement-change/fixtures/`, CI archon job.

### INT-007: The review scripts work against a real git repository
- Covers: change-review "The first review covers the whole change" (Whole change is covered, Start cannot be read); "The builtin reviewer only inspects the changed code" (Change folder is left out, Reviewer changes nothing); "A re-review checks the fixes, the declines and the new changes" (Earlier code is not reviewed again, Nothing to review); "Findings that were not fixed go to the assumptions record" (Disputed finding, Nothing remains); "A later cycle does not reopen recorded findings"; "Each review place keeps one result"; "The pull request's head is reviewed" (Head was reviewed); pack-settings-and-run-files "Agents and scripts share named files under the artifacts folder" (Review result is recorded).
- Boundary: the scripts under `implement-change/scripts/` calling git and writing under `$ARTIFACTS_DIR`, with their inputs and outputs in the form Archon uses.
- Setup: a temporary git repository built with `tests/helpers.ts`, with commits inside and outside a change folder. A temporary artifacts folder holds an `acceptance-assumptions.md` that contains the line `No unresolved assumptions or context gaps.`.
- Action: run `prepare-review`, `record-review`, `hand-off-review` and the tail and acceptance modes as bun child processes, with the input environment and `ARTIFACTS_DIR` set as Archon sets them.
- Assertions:
  - each script prints one JSON document that matches its node's schema;
  - the range names only files outside the change folder;
  - an empty or unknown start revision fails, naming the reason;
  - a head that moves between `prepare-review` and `record-review` fails, naming the review;
  - when the fixer commits and then reports itself blocked, the round's end leaves the last reviewed revision unchanged, and the tail mode then reports the fixer's commit as a new range;
  - an acceptance round's first range includes tracked changes left uncommitted;
  - one `review/state.json` holds every cycle's findings, with IDs unique across the run, and each later cycle's prepare step outputs the findings already handed off;
  - a range with no changes and no open finding reports no review needed;
  - the hand-off adds one `## ` section for each `high` or `medium` finding that is not closed, with both sides for a contested or disputed one, and one for each `high` or `medium` finding closed by an accepted decline or reply, and removes the nothing-unresolved line;
  - a `low` finding that is not closed is in the result file and not in `acceptance-assumptions.md`;
  - a cycle left unfinished, as after a failed run is resumed, is handed off by the next hand-off;
  - a second hand-off adds nothing, and a cycle whose `high` and `medium` findings all closed with confirmed fixes adds nothing;
  - the result files are `review/before-pr.md` and `review/acceptance.md`, and the before-pull-request result ends at the head;
  - `review/acceptance.md` is rewritten in each round that reviews, and the round's range starts at the last revision any review covered.
- Constraints: plain git only, no network. If a stubbed agent node records no checkout observation in a dry run, the review fixtures stub `prepare-review`, and this test and HT-001 cover the script.
- Execution: `factory-workflows/archon/tests/review.test.ts`, `bun test tests/`, CI archon job.

## End-to-End Tests

None. No automated test in this repository runs live agents or a forge, and no automated test will run an entire workflow with live agents. Starting providers, forking sessions and running loops are Archon's behavior, not the pack's. Whether a model follows the review instructions well is measured by evaluation runs, outside this repository. The dry-run fixtures are the highest automated layer, and HT-001 covers this change's live risks once.

## Acceptance Testing Envelope

- Environments and sandboxes: the run's worktree of the repository. bun 1.4.4 and the pack's dev tools, through `bun run lint`, `bun test tests/` and `bun run test:fixtures`. Archon from the local fork checkout, at the commit CI pins or the one the launcher uses. `archon validate workflows`, `archon workflow test`, and dry runs, including `--exec-code` dry runs, on scratch git repositories with a throwaway `ARCHON_HOME`, as `tests/run-fixtures.ts` does.
- Credentials and secrets: none are needed. The pass must not use the forge credential or any provider credential.
- Authorized effects: local files under the run's worktree, its artifacts folder and temporary directories, removed when done. No live agent runs and no forge writes.
- Off limits:
  - the factory, its LaunchAgent, its state database and its private folder;
  - any paused or running evaluation run;
  - the user's global Archon home and config;
  - the Archon fork checkout;
  - Chrome or server processes another session started;
  - pushes, branches or pull requests on any real repository;
  - a live launch of `codagent-implement-change`.
- Permitted substitutes: stubbed agent outputs and executable dry runs in place of live agents. Scratch git repositories in place of a real project.
- Known risk areas:
  - the review-off route through skipped nodes and trigger rules;
  - Archon refusing an unknown `review_strategy` at launch, before any node runs;
  - each provider's strict-mode handling of the output schemas;
  - the change-folder exclusion in the review range;
  - the moved verification fixtures and the removed inputs;
  - the merged input validation.
- Accepted limitations: dry runs reach only a loop's first iteration. A resumed run restarts an interrupted fix loop with three new rounds.

## Human-Only Testing

### HT-001: One live run of a dummy change
- Reason: it spends real agent tokens and creates and deletes a GitHub repository with a draft pull request. That needs the user's authority, and the acceptance pass may not do it.
- Prerequisites: the lint, the bun tests and the fixtures pass, and the acceptance pass is complete.
- Instructions:
  1. Create a fresh private throwaway GitHub repository. Give it a tiny OpenSpec change whose obvious implementation invites an error-handling finding, such as reading a configuration file.
  2. Launch `codagent-implement-change` on it from the change's branch of the pack, with `acceptance_rounds: 3` and the launch checkout's role bindings. The last round only tests, so three rounds allow two acceptance fixes and two round reviews.
  3. When the run ends, read its artifacts folder, the draft pull request and the run's cost.
  4. Delete the repository.
- Required decision or observation:
  - `review/before-pr.md` exists and names the range it covered;
  - when there was a finding, a fix round ran, with the fixer continuing the implementor's session and the re-review continuing the reviewer's;
  - any finding that was not closed is in `acceptance-assumptions.md`, with both sides if it was disputed;
  - the draft pull request opened at the reviewed head;
  - any acceptance fix had its own review;
  - when two acceptance rounds reviewed a fix, the second round's review started a new reviewer session;
  - the cost is acceptable.

  A path the run did not reach is inconclusive, not passed: a fix round before the pull request, a fix round in an acceptance round, or a second round's review. The user decides whether to run another dummy change for it.

## Coverage Map

| Requirement or journey | INT | E2E | HT |
| --- | --- | --- | --- |
| change-review: The review strategy picks the reviewer | INT-001, INT-002, INT-006 | — | HT-001 |
| change-review: The builtin reviewer only inspects the changed code | INT-007 | — | — |
| change-review: A review cycle keeps one reviewer session | INT-003, INT-005, INT-006 | — | HT-001 |
| change-review: Every strategy returns the same findings shape | INT-002 | — | — |
| change-review: The first review covers the whole change | INT-007 | — | HT-001 |
| change-review: The implementor fixes the findings in its own session | INT-003, INT-006 | — | HT-001 |
| change-review: Each fix round is a fixer turn and a re-review | INT-003 | — | HT-001 |
| change-review: A re-review checks the fixes, the declines and the new changes | INT-007 | — | — |
| change-review: Fix rounds are bounded | INT-004, INT-006 | — | — |
| change-review: Findings that were not fixed go to the assumptions record | INT-004, INT-006, INT-007 | — | HT-001 |
| change-review: A later cycle does not reopen recorded findings | INT-007 | — | — |
| change-review: The pull request's head is reviewed | INT-005, INT-007 | — | HT-001 |
| change-review: Each review place keeps one result | INT-007 | — | HT-001 |
| change-implementation: The change is reviewed after the assumptions handoff check | INT-001, INT-002 | — | — |
| acceptance-rounds: An acceptance fix is reviewed before it is pushed | INT-006 | — | HT-001 |
| pack-settings-and-run-files: Agents and scripts share named files under the artifacts folder (review result) | INT-007 | — | — |
