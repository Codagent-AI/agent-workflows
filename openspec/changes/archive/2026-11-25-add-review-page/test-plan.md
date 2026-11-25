## Coverage Strategy

Specifications remain the source of unit-test requirements. This plan records only additional integration and end-to-end obligations, the acceptance testing envelope, and exceptional human-only obligations.

This change is for the Archon pack in `factory-workflows/archon/`, with small changes to `human-workflows/openspec/` and `human-workflows/archon/`. Workflow paths below are relative to `factory-workflows/archon/.archon/workflows/codagent/`. Node names are the ones `design.md` gives.

The pack has two automated layers, and both run in the archon CI job:

- **bun tests** in `factory-workflows/archon/tests/*.test.ts`, run by `bun test tests/`. They build real temporary git repositories with `tests/helpers.ts`, with fake `archon`, `gh`, `openspec` and `cloc` commands.
- **Archon dry-run fixtures** in `implement-change/fixtures/`, run by `bun run test:fixtures` on the pinned Archon fork, which must include the `pages` change. Agent nodes are stubbed. A dry run does not evaluate `until_bash`, so a fixture reaches only a loop's first pass. A wait with no stub pauses the simulation, so a fixture that ends at the wait expects `paused`.

Each risk goes to the cheapest layer that catches it:

- Routing is where a wrong `when:`, `trigger_rule` or output binding would skip the page, skip the wait, fail a run that should wait, or run a round step on the wrong pass. A binding to a node the pass skipped fails the run, so each fixture leaves the skipped nodes unstubbed. A fixture can reach only the first pass, so each round kind gets its own fixture, with `start-round`'s output stubbed to that round's mode.
- The fixtures that end at `publish-review-package` today set `review_wait: "false"` and keep testing what they test now. The others stay as they are.
- `start-round`, `check-response`, `end-run`, `merge-base`, the archive, the inventory, the ranking check and the publisher read and write the run's files, git and the forge. bun tests run them against real repositories and run folders.
- The page's send logic is a small module the publisher inlines into the page. bun tests run it with a fake fetch.
- The fork's own tests cover the `pages` field and the page policy. This plan does not repeat them.
- These need real Archon, a real forge, real agents or a browser, so the acceptance pass covers them:
  - an answer extending the loop by one pass;
  - a skipped wait ending the loop, and `until_bash` ending it after a merge;
  - a stale answer re-asking;
  - a paused run surviving a restart;
  - resuming a run that failed in a round;
  - the page in a browser and a real merge.

The prompt and skill changes, such as the codes the prompts and the `test-plan` skill write, are static content and get no tests.

## Integration Tests

### INT-001: The first pass publishes the page and pauses at the wait
- Covers: review-response "The run waits for the reviewer" (Wait on); pack-settings-and-run-files "The review wait is a setting" (Default); review-handoff "Every run whose acceptance rounds end writes a review page".
- Boundary: the `review-rounds` loop's first pass, from `start-round` through the tail to `wait-for-review`.
- Setup: `happy-path.stubs.yaml`, updated. `start-round` returns mode `first`, round 1 and `archive_needed` true. The tail's stubs stay as they are. `wait-for-review` and `end-run` have no stub, and neither do the round's own steps.
- Action: `archon workflow test` through `bun run test:fixtures`.
- Assertions: the simulation pauses. It reaches `start-round`, `commit-logs`, the archive nodes, `record-archive`, `finalize-push`, `mark-ready`, `final-ci`, `record-finalize`, the ranking nodes, `publish-review-package` and `wait-for-review`. It does not reach `merge-base`, `address-feedback`, `push-round` or `end-run`.
- Execution: `implement-change/fixtures/`, CI archon job.

### INT-002: With the wait off, the run ends after the first page
- Covers: review-response "The run waits for the reviewer" (Wait off); pack-settings-and-run-files "The review wait is a setting" (Evaluation turns it off); pull-request-finalization "The run ends in one of three states" (Succeeded, Needs attention, Failed); review-handoff "Every run whose acceptance rounds end writes a review page" (Run ends after a failed step).
- Boundary: the loop's first pass with `wait-for-review` skipped, the loop's end under `on_exhausted: complete`, and `end-run` as the `returns` node.
- Setup: the existing fixtures that end at `publish-review-package` set `review_wait: "false"`. `end-run` takes the outcome stub `publish-review-package` has today, and `publish-review-package` returns its message and page. `wait-for-review` has no stub.
- Action: `archon workflow test`.
- Assertions: each fixture completes with the authored outcome it has today and reaches `publish-review-package` and `end-run`. Reaching `wait-for-review` would pause the simulation and fail the fixture.
- Execution: `implement-change/fixtures/`, CI archon job.

### INT-003: Stop after acceptance ignores the wait, and an invalid wait value is refused
- Covers: pack-settings-and-run-files "A run can end after the acceptance rounds" (Wait is on); "Every other value comes from a pack setting" (Invalid review wait).
- Boundary: `validate-inputs` and the `when:` on `review-rounds`.
- Setup: `stop-after-acceptance.stubs.yaml`, with `review_wait` left at its default and `end-run` added. A new `invalid-review-wait` fixture like `invalid-acceptance-rounds`, with `exec-code: true` and `review_wait: "maybe"`.
- Action: `archon workflow test`.
- Assertions: the first completes through `end-after-acceptance` and `end-run`, and reaches no node of `review-rounds`. The second fails at `validate-inputs`.
- Execution: `implement-change/fixtures/`, CI archon job.

### INT-004: A feedback round runs its own steps, then the tail, then waits
- Covers: review-response "A feedback round first merges in the base branch" (Base branch moved, Conflict resolved with a judgment call); "A feedback round addresses the feedback and publishes again" (Feedback addressed); "Retest reruns the listed journeys" (Retest chosen); "A refused merge runs another round"; change-archive "A feedback round reruns an archive that did not pass" (Archive failed before, Archive passed before); change-review "A review cycle keeps one reviewer session" (Feedback round review); "Fix rounds are bounded" (Feedback round review); pull-request-finalization "Finalize runs in every feedback round" (Round gets its own cycles); review-handoff "Every run whose acceptance rounds end writes a review page" (Feedback round ends).
- Boundary: the guards on the round's own steps and on the tail for modes `feedback` and `refused`, and the tail's bindings when the archive nodes skip.
- Setup: new fixtures, each with `start-round` stubbed to mode `feedback` and round 2 unless noted. The archive nodes have no stub unless the archive is needed.
  - the base merged cleanly and the archive passed, with `archive_needed` false;
  - `merge-base` reports a conflict;
  - the answers chose Retest;
  - the archive had not passed, with `archive_needed` true;
  - `review_strategy: none`;
  - mode `refused`.
- Action: `archon workflow test`.
- Assertions:
  - each pauses at `wait-for-review` after `publish-review-package`, and none reaches `commit-logs`;
  - the clean merge reaches `merge-base`, `address-feedback`, `check-response`, the round review with one fix turn and one re-review, `push-round`, `record-archive`, finalize and the ranking nodes, and not `resolve-merge`, the retest or the archive nodes;
  - the conflict reaches `resolve-merge`;
  - Retest reaches the retest's tester, CI wait, handoff and gate, and no acceptance fix;
  - the archive that had not passed reaches the archive nodes, and its repair's resolved text names the answers file `start-round` returned;
  - `review_strategy: none` reaches no round review node;
  - `refused` reaches the same round steps as the clean merge.
- Execution: `implement-change/fixtures/`, CI archon job.

### INT-005: A merged or closed pass ends the run, and a stale one waits again
- Covers: review-response "Merge" (Merge accepted, A failure hides Merge); "Only the current round's answer counts" (Answer from an earlier page, Empty answer); "The run handles each merge outcome" (Merged outside the run, Closed outside the run); pull-request-finalization "The run merges only when the reviewer chooses Merge" (Run ends); "The run ends in one of three states" (Merged).
- Boundary: the guards for modes `merged`, `closed` and `stale`, and the wait's bindings on a stale pass.
- Setup: three new fixtures. In the first, `start-round` returns mode `merged` and `end-run` returns succeeded. In the second, mode `closed` and `end-run` returns failed. In the third, mode `stale`, and `publish-review-package` returns round 1's message and page. No other tail node has a stub in any of them.
- Action: `archon workflow test`.
- Assertions:
  - `merged` completes with authored outcome succeeded, reaches `end-run`, and reaches no tail node, not `publish-review-package` and not `wait-for-review`;
  - `closed` completes the same way with authored outcome failed;
  - `stale` pauses at `wait-for-review`, reaches `publish-review-package`, and reaches no other tail node.
- Execution: `implement-change/fixtures/`, CI archon job.

### INT-006: A failure a round step reports still publishes and waits
- Covers: pack-settings-and-run-files "A failed step in a feedback round does not stop the run" (Finalize fails in a feedback round, Description update fails); review-response "A feedback round first merges in the base branch" (Conflict needs a person); change-archive "A feedback round reruns an archive that did not pass" (Archive still fails); review-handoff "Each failed step is a red item" (Push failed in a feedback round).
- Boundary: `check.ts` in report mode and the `trigger_rule` of each body node after a round step that can report a failure.
- Setup: new fixtures in mode `feedback`, one per failure:
  - `merge-base` records a conflict it could not resolve;
  - `address-feedback` returns `blocked: true`;
  - `check-response` rejects entries;
  - `push-round` still fails after its repair;
  - the archive still fails after its repair;
  - finalize still fails after its repairs;
  - `publish-review-package` reports a failed description update.
- Action: `archon workflow test`.
- Assertions: each pauses at `wait-for-review` after reaching `publish-review-package`.
- Execution: `implement-change/fixtures/`, CI archon job.

### INT-007: `start-round`, `end-run` and the merge work on real run files and a fake forge
- Covers: review-response "The run records each answer" (Feedback received, Merge received, Plain-text merge, Plain-text feedback); "Only the current round's answer counts"; "Merge"; "The run handles each merge outcome"; "A refused merge runs another round" (Branch no longer merges, Head moved); "A resumed run continues its review round"; pull-request-finalization "The run merges only when the reviewer chooses Merge"; "The run ends in one of three states"; "Finalize runs in every feedback round" (Round fixes a finalize failure); draft-pull-request "Forge access is checked before any agent spends" (Forge cannot merge, Wait is off); "Each round's publish rewrites the generated description" (Merge chosen); pack-settings-and-run-files "The review rounds keep their files" (Two rounds).
- Boundary: `start-round` and `end-run` through `finish-run.ts`, the run's files, and the forge through a fake `archon forge`.
- Setup: a temporary run folder with round 1's `review-page-round-1.html`, `review-page.html` and `review/pages.json`, and a round 1 finalize result with a terminal entry. Answers are given as each kind:
  - page JSON for feedback, with a note holding `</script>`;
  - page JSON for merge;
  - plain `merge` in mixed case, and other plain text;
  - page JSON naming round 0, and empty text;
  - no answer, with round 1's answers saved and no round 2 page, as after a failed round is resumed;
  - a merge while round 1's finalize failed.

  The fake forge reports the pull request open, merged or closed. It accepts a merge, refuses it as moved, refuses it for a required approval, or reports the outcome as unknown. `check-forge` gets a fake plugin with and without `pr.merge`.
- Action: run each op as the workflow runs it.
- Assertions:
  - an accepted answer is saved as `review-answers-round-1.json`;
  - it is written into the `sent-answers` block of round 1's page, escaped, and into `review-page.html` only while that is still round 1;
  - round 1's entry in `review/pages.json` changes status;
  - feedback returns mode `feedback` and round 2, with plain text kept as one note;
  - feedback clears finalize's results and the round steps' entries, after copying them into `review/round-1/`, and a second start of round 2 leaves that copy as it was;
  - the resumed case returns mode `feedback` and round 2 and leaves round 1's page and answers unchanged;
  - merge calls `pr.merge` with `method: merge` and the page's head, writes `review/outcome.json`, and then rewrites the description entry as merged;
  - a merge while finalize failed returns `stale` with the reason and never calls the forge;
  - a moved refusal returns `refused` with the forge's reason and writes no outcome;
  - a refusal for a required approval returns `stale` with the forge's reason;
  - an unknown outcome reads the pull request back, returning `merged` when it was merged and `stale` when it was open;
  - a pull request merged or closed outside the run returns `merged` or `closed` and writes the outcome;
  - a round 0 answer and empty text return `stale` and write nothing;
  - the outputs give the change folder, `archive_needed`, `retest`, `journeys` and the answers file;
  - `end-run` gives merged as succeeded and closed as failed, and with the wait off gives the outcomes `publish-review-package` gives today;
  - `check-forge` asks for `pr.merge` only with the wait on.
- Execution: `factory-workflows/archon/tests/review-package.test.ts` and `tests/pull-request.test.ts`, CI archon job.

### INT-008: `merge-base` merges the base into the branch in a real repository
- Covers: review-response "A feedback round first merges in the base branch" (Base branch moved, Conflict needs a person, Someone pushed to the branch).
- Boundary: `merge-base` with real git, a bare remote and the fake forge.
- Setup: a temporary repository with a bare origin. The fake forge names the pull request's base, in one case a different branch from the one at launch. The base gets a new commit, in one case touching the branch's files and in another not. Another clone pushes to the pull request branch.
- Action: run `merge-base`.
- Assertions:
  - it merges the base the forge names;
  - a clean base merge makes a merge commit;
  - the remote tip of the branch is merged in;
  - a conflict leaves the merge in progress for `resolve-merge`;
  - the abort path writes `review/merge-conflicts.md` and leaves a clean tree;
  - running it again after it succeeded changes nothing;
  - no rebase or force push happens.
- Execution: `factory-workflows/archon/tests/finalize.test.ts`, CI archon job.

### INT-009: The inventory, the response check and the ranking check work across rounds
- Covers: review-response "The next page reflects the round" (Failure fixed, Dispute settled); "The late commit item lists the journeys its commits could affect"; "Retest reruns the listed journeys" (Retest passes, Same-round commits stay); "A failed retest is a red item"; "Feedback that needs a spec change is declined, then asked about"; review-handoff "The testing evidence is gathered for the ranking" (Commits follow acceptance, Base branch merged in); "Every item is ranked in one tier" (Unverified row has a named test, Named test outside CI); "Each failed step is a red item"; "A script checks the ranking"; "The ranking asks a question on each item that needs one"; "The ranking picks the key evidence"; "The check covers questions and key evidence"; "The fallback keeps the agent's valid questions and picks"; "A dispute log records what the agents left unfixed without agreement".
- Boundary: `review-inventory.ts`, `check-response` and `review-package.ts` over a real run folder and repository.
- Setup: a run folder and repository with:
  - logs written in both the new and the old code forms;
  - three rounds of response files: round 1 marks CHECK-3 `no-change`, round 2 does not mention it, and one entry marks a dispute `spec-change` with an edit;
  - a response file with an unknown code and an unknown status;
  - a fixed failure in a fresh `step-results.json`, and recorded failures of the retest, the base merge, `address-feedback`, the response check, the push and the description;
  - screenshot manifests and journey files for two acceptance rounds, and a test plan with old `AT-` cases;
  - `review/accepted-head.txt`, later commits on the branch, a base merge that brings in forty commits cleanly, a base merge that resolved a conflict, and `review/retested-commits.json` listing some of the later commits;
  - a finalize result with `had_checks`, and a checklist row citing a test file that exists.
- Action: build the inventory, run the response check, then check and place rankings, valid and invalid.
- Assertions:
  - items keep their source codes from round to round, and an answer naming any of an item's codes applies to it;
  - CHECK-3 stays out of the required set in round 3, and the check and placing reject it;
  - a dismissed late commit stays out while a newer commit still shows;
  - the fixed failure is gone, and each recorded failure is a red Failure item;
  - the response check drops the bad entries and records a failure;
  - later commits come from `review/accepted-head.txt` with first-parent history: the forty base commits are not listed, the clean base merge is not listed, the resolving merge is listed by its resolutions, and the retested commits are not listed;
  - the cited-test row is a required yellow item when finalize passed with checks, and a required red one when it did not;
  - the spec-change dispute is a required red item, the check rejects its question without the follow-up and drop options, and placing gives it the edit, follow-up and drop options;
  - the check rejects each case `design.md` lists, including a red, orange or yellow item with no question, a question with one or five options, an unknown screenshot, a journey code that no journey file lists, and an unknown commit, and it accepts an `AT-` code the old test plan lists;
  - placing keeps the agent's valid questions and picks, and gives standard questions to the items it adds;
  - old and new codes are both accepted.
- Execution: `factory-workflows/archon/tests/review-package.test.ts`, CI archon job.

### INT-010: The publisher writes the pages, the round files and the description
- Covers: review-page "A page for each review round"; "Size of the change"; "Key evidence and screenshots" (No screenshots); "Read-only content"; "When the page cannot send" (Wait turned off); "An answered page is a read-only record"; "Works as a file"; review-handoff "The page's state line"; "Every run whose acceptance rounds end writes a review page" (Package cannot be written); review-response "The next page reflects the round" (Summary of the round); draft-pull-request "Each round's publish rewrites the generated description" (Page entries, Merge refused, Archon's address is unknown); pack-settings-and-run-files "Archon's address is a setting"; "A failed step in a feedback round does not stop the run" (Description update fails).
- Boundary: `publish-review-package` through `finish-run.ts`, writing the run's files, running a fake `cloc`, and rewriting the description through the fake forge.
- Setup: a temporary repository and run folder for round 1 and round 2. Agent text holds `</script>`, `<img onerror>` and `&`. Cases:
  - a fake `cloc`, and no `cloc` on the path;
  - screenshot manifests, and none;
  - `archon_url` set, and empty;
  - the wait on, and off;
  - the archive failed;
  - finalize failed;
  - round 1's Merge refused with a reason;
  - the description edit fails, in round 1 and in round 2;
  - a stale pass with a reason.
- Action: run the publish op.
- Assertions:
  - round 1 writes `review-page-round-1.html` and `review-page.html`, and round 2 adds `review-page-round-2.html` while round 1's page stays as it was;
  - `review/pages.json` lists both rounds with their messages, each starting `Review round <n>:`;
  - the page's data block parses as JSON and holds the agent text, escaped;
  - `cloc` gets the merge base and the lock-file exclusions, and with no `cloc` the data says the count is unavailable;
  - links to screenshots are relative;
  - round 2's data has the recap from `review-response-round-1.json`, and round 1's has none;
  - Merge and the buttons are flagged off as each case requires;
  - the state line names the failure that hides Merge and counts the red items;
  - the description lists both rounds oldest first, linked with `archon_url` and named without it, with round 1's entry saying Merge was refused and why;
  - a failed description edit in round 2 records a failure that round 2's page shows as a red item, and the op succeeds; in round 1 it fails the op, as today;
  - a stale pass writes nothing and returns the current round's message, with the reason after the round prefix, and its page;
  - a publish that cannot write the page fails, as the existing `package-failed` fixture expects of the run.
- Execution: `factory-workflows/archon/tests/review-package.test.ts`, CI archon job.

### INT-011: The page's send logic answers only its own round's wait
- Covers: review-page "Send feedback" (Feedback sent); "Merge" (Merge sent); "When the page cannot send" (Run not waiting for this page, Archon cannot be reached); "After sending".
- Boundary: the send module the publisher inlines into the page, with a fake `fetch` and a fake page address.
- Setup: page data for round 1 and for round 2. The fake attention response gives a pending wait whose message starts with `Review round 2:`, one for round 1, one for round 12, none, a 409 on the answer, and a network error. One case has no Archon address, as for a page opened as a file.
- Action: call the module's send with feedback answers, then with merge.
- Assertions:
  - with a matching wait it posts `{ occurrence, text }` to the run's answer address, and the text parses as JSON with the action, round, head and answers;
  - round 1's page sends nothing to a round 12 wait;
  - a round 1 wait, no wait, or a 409 posts nothing more and reports that the run is not waiting for this page;
  - a network error or a file page returns the copy command, with the occurrence when the page read one and with the lookup otherwise.
- Execution: `factory-workflows/archon/tests/review-package.test.ts`, CI archon job.

### INT-012: A rerun of a failed archive passes its own check after other commits
- Covers: change-archive "A feedback round reruns an archive that did not pass" (Archive failed before); "A chosen spec edit follows the archive's state".
- Boundary: `archive.ts` with a real repository and `openspec`.
- Setup: a temporary repository whose first archive attempt fails after leaving archive paths uncommitted. Then the branch gets a merge of the base and a commit outside the change folder, as a feedback round makes. In a second case the round also edits the change's delta.
- Action: run `archive-change` and `verify-archive-commit` again, as a feedback round does.
- Assertions:
  - the earlier attempt's `state.json`, `before.json` and `specs-before.json` are in `archive/attempt-1/`;
  - the new attempt's baseline starts at the round's head;
  - the uncommitted archive paths from the earlier attempt are the new attempt's own;
  - the check passes, and the round's other commits are not counted against it;
  - the edited delta is what the archive applies.
- Execution: `factory-workflows/archon/tests/archive.test.ts`, CI archon job.

## End-to-End Tests

None. The real path needs live agents, a forge, a browser and a running Archon. The acceptance pass covers it under the envelope below.

## Acceptance Testing Envelope

- Environments and sandboxes:
  - an Archon built from the fork with the `pages` change, as the fixtures run;
  - a separate Archon instance with its own home and port, started and stopped by the pass, for a restart, for resuming a failed run, and for serving test pages;
  - a script-only workflow in a scratch repository, with a loop whose body ends in an attention wait with `pages`, which costs nothing and should run before the live trial;
  - run folders written by the publisher from prepared data, with screenshots from two acceptance rounds, served by the separate instance;
  - headless Chrome, one browser at a time;
  - the trial repository `pacaplan/archon-live-trial` and its change `add-greeting-config`, through `bun run live-trial`.
- Credentials and secrets: the `gh` login and the agents' provider logins on this machine. Run `gh` and pushes with `GH_TOKEN` and `GITHUB_TOKEN` unset. No other secret is needed.
- Authorized effects:
  - local scratch repositories, Archon homes and run folders, removed when done;
  - one live trial. It spends provider usage for every role, takes 30 to 60 minutes, and opens a public draft pull request on the trial repository;
  - while the trial is open, the pass may push to the trial branch, answer the run from the page, the Archon CLI or the UI, and resume the trial's run;
  - it may also make a branch from the trial repository's main, named `trial-base-<stamp>`, point the pull request at it, and merge there from the page;
  - cleanup runs `bun run live-trial cleanup <branch>`, which closes the pull request if still open and deletes the trial branch, then deletes `trial-base-<stamp>`.
- Off limits:
  - the shared `archon serve` and its runs, which the pass must not restart;
  - Chrome or servers another session started;
  - the trial repository's main, which no merge may target;
  - agent-workflows main and the fork's `dev`;
  - the factory and its state.
- Permitted substitutes:
  - The trial's change is a CLI, so its acceptance pass may save no screenshots. The prepared run folders stand in for the screenshot sections.
  - When nothing serves the trial's run, `archon workflow wake` may continue an answered run.
- Known risk areas:
  - a pass whose wait is skipped must end the loop, and `until_bash` must not end it after a pass that waited;
  - a stale pass waits again, which must not trigger Archon's one-time re-ask;
  - a resumed run restarts the loop at its first pass and must continue its round, not rewrite round 1;
  - an answered run continues only under `archon serve` or after `archon workflow wake`, and that host needs cloc, bun and the logins;
  - a paused run must survive an Archon restart with its worktree and implementor session;
  - only the named pages may reach Archon's API, and an agent-written HTML artifact in the same run must not;
  - a tab left open on an earlier round must not answer a later one;
  - agent text on the page must never run as markup;
  - a pull request merged or closed on the forge is noticed only at the next answer;
  - a round's first implementor turn reads the whole session uncached, so the pass records its cost;
  - a spec edit after the archive lands in `openspec/specs/`, which is an accepted limitation;
  - the evaluation harness reads old `AT-` codes, so old codes must keep working.

## Human-Only Testing

None.

## Coverage Map

| Requirement or journey | INT | E2E | HT |
| --- | --- | --- | --- |
| review-response: The run waits for the reviewer | INT-001, INT-002 | - | - |
| review-response: The run records each answer | INT-007 | - | - |
| review-response: Only the current round's answer counts | INT-005, INT-007 | - | - |
| review-response: A feedback round first merges in the base branch | INT-004, INT-006, INT-008 | - | - |
| review-response: A feedback round addresses the feedback and publishes again | INT-004 | - | - |
| review-response: The next page reflects the round | INT-009, INT-010 | - | - |
| review-response: The late commit item lists the journeys its commits could affect | INT-009 | - | - |
| review-response: Retest reruns the listed journeys | INT-004, INT-009 | - | - |
| review-response: A failed retest is a red item | INT-009 | - | - |
| review-response: Feedback that needs a spec change is declined, then asked about | INT-009 | - | - |
| review-response: Merge | INT-005, INT-007 | - | - |
| review-response: The run handles each merge outcome | INT-005, INT-007 | - | - |
| review-response: A refused merge runs another round | INT-004, INT-007 | - | - |
| review-response: A resumed run continues its review round | INT-007 | - | - |
| review-page: A page for each review round | INT-010 | - | - |
| review-page: Size of the change | INT-010 | - | - |
| review-page: Key evidence and screenshots | INT-010 | - | - |
| review-page: Read-only content | INT-010 | - | - |
| review-page: Send feedback | INT-011 | - | - |
| review-page: Merge | INT-011 | - | - |
| review-page: When the page cannot send | INT-010, INT-011 | - | - |
| review-page: After sending | INT-011 | - | - |
| review-page: An answered page is a read-only record | INT-010 | - | - |
| review-page: Works as a file | INT-010 | - | - |
| review-handoff: Every run whose acceptance rounds end writes a review page | INT-001, INT-002, INT-004, INT-010 | - | - |
| review-handoff: A dispute log records what the agents left unfixed without agreement | INT-009 | - | - |
| review-handoff: The testing evidence is gathered for the ranking | INT-009 | - | - |
| review-handoff: Every item is ranked in one tier | INT-009 | - | - |
| review-handoff: Each failed step is a red item | INT-006, INT-009 | - | - |
| review-handoff: A script checks the ranking | INT-009 | - | - |
| review-handoff: The page's state line | INT-010 | - | - |
| review-handoff: The ranking asks a question on each item that needs one | INT-009 | - | - |
| review-handoff: The ranking picks the key evidence | INT-009 | - | - |
| review-handoff: The check covers questions and key evidence | INT-009 | - | - |
| review-handoff: The fallback keeps the agent's valid questions and picks | INT-009 | - | - |
| pull-request-finalization: The run merges only when the reviewer chooses Merge | INT-005, INT-007 | - | - |
| pull-request-finalization: The run ends in one of three states | INT-002, INT-005, INT-007 | - | - |
| pull-request-finalization: Finalize runs in every feedback round | INT-004, INT-007 | - | - |
| change-archive: A feedback round reruns an archive that did not pass | INT-004, INT-006, INT-012 | - | - |
| change-archive: A chosen spec edit follows the archive's state | INT-012 | - | - |
| change-review: A review cycle keeps one reviewer session | INT-004 | - | - |
| change-review: Fix rounds are bounded | INT-004 | - | - |
| draft-pull-request: Forge access is checked before any agent spends | INT-007 | - | - |
| draft-pull-request: Each round's publish rewrites the generated description | INT-007, INT-010 | - | - |
| pack-settings-and-run-files: Every other value comes from a pack setting | INT-003 | - | - |
| pack-settings-and-run-files: A run can end after the acceptance rounds | INT-003 | - | - |
| pack-settings-and-run-files: The review wait is a setting | INT-001, INT-002 | - | - |
| pack-settings-and-run-files: Archon's address is a setting | INT-010 | - | - |
| pack-settings-and-run-files: The review rounds keep their files | INT-007 | - | - |
| pack-settings-and-run-files: A failed step in a feedback round does not stop the run | INT-006, INT-010 | - | - |
