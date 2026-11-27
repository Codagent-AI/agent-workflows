## DECIDE-1: Finalize names failing checks when the results include them

Step: Implement the failed-step inventory.
Question: How should the finalize fixed line reconcile the design's general wording with the spec's failed-check scenario?
Requirement: A failed finalize check on the final head is named and Merge is blocked until it passes. The fixed text comes from run results without raw output.
Decision: Start the line with the design's general finalize failure sentence. When the structured CI report names failing checks, add their names and the merge consequence to the same fixed line.
Alternatives: Always use the general line, or copy the recorded problems verbatim.
Rationale: The structured names satisfy the specific scenario and keep unrelated check output out of the page. See `implementation-decisions-inspection.log` and the fixed finalize line test in `finalize-targeted.log`.
What breaks if wrong: Reviewers may see a general failure with no useful check name, or unnecessary raw output.
Decision pending from the user: None.

## DECIDE-2: Verify coverage against the passing CI job

Step: Implement the checklist ranking inventory.
Question: What proves that a named test was part of the final-head CI pass?
Requirement: An unverified row is yellow only when the named automated test ran in a passing finalize suite.
Decision: Match final-head passing check names to committed GitHub Actions jobs and the test paths or directories in their direct test commands. Keep unproven coverage red.
Alternatives: Treat every tracked test as run when any check passes, or have the ranking agent infer coverage alone.
Rationale: A tracked test can be outside CI. The committed jobs and saved check result provide independent evidence without running the test again. See `implementation-decisions-inspection.log`.
What breaks if wrong: A test hidden behind dynamic CI commands may leave an unnecessary red item, while overbroad inference could hide a gap.
Decision pending from the user: None.

## DECIDE-3: Keep full-size evidence inside the review page

Step: Implement screenshot viewing.
Question: How should screenshots open at full size when links leaving the page are GitHub-only?
Requirement: Screenshots open at full size, and links leaving the page go to GitHub.
Decision: Keep the screenshot in its dialog and add a control that toggles between fit-to-view and full-size display.
Alternatives: Open a run-file link in another tab, or limit the viewer to a scaled image.
Rationale: The existing image can display at natural size in a scrollable dialog. See `implementation-decisions-inspection.log`.
What breaks if wrong: Oversized screenshots may be harder to inspect, or the page may expose a run-file link.
Decision pending from the user: None.

## DECIDE-4: Preserve the feedback authorization boundary

Step: Implement review resume and inspect feedback round limits.
Question: Does the workflow's one-iteration setting limit the number of feedback rounds?
Requirement: Each new answer can start a feedback round without a round limit, and a failed feedback push resumes from saved feedback.
Decision: Keep the existing iteration bound for autonomous work and handle each explicit answer as Archon's authorized additional iteration. Rebuild the pending round on failed push resume.
Alternatives: Use a larger finite loop cap or add a separate feedback workflow.
Rationale: Archon extends the bound for an explicit wait answer. The package can preserve the current loop and existing resume records. See `implementation-decisions-inspection.log`.
What breaks if wrong: Later answers could stop progressing or a push resume could lose its saved feedback.
Decision pending from the user: None.

## DECIDE-5: Restore the log files when a later sync commit fails

Step: Implement syncing run log entries during feedback.
Question: How can the workflow continue after a failed log commit when the next push rejects a modified tracked file?
Requirement: Record the log failure and continue, while every push fails on uncommitted tracked changes.
Decision: Restore the log files to their prior worktree contents after a failed sync commit and keep the sync counts unchanged. The additional entries stay in the run log.
Alternatives: Leave the failed sync staged, or advance the counts despite the commit failure.
Rationale: Restoration keeps the push eligible and allows a later sync to retry the same entries. See the sync failure test in `finalize-targeted.log`.
What breaks if wrong: A log commit failure could stop publication at push, or an open retest decision could disappear from future ranking.
Decision pending from the user: None.

## DECIDE-6: Preserve a blocked CI fix separately from a push failure

Step: Recheck the finalize paths after the broader suite.
Question: How should finalize report a blocked fix that still made a pushable commit?
Requirement: A reported non-push finalize failure continues to the review page. A push that still fails stops the run, and its recheck always attempts the push.
Decision: Record the blocked CI fix as a terminal finalize check independently of the push. Push any committed work and apply normal push repair and recheck rules.
Alternatives: Skip the push on a blocked fix, or conflate the blocked fix with a failed push.
Rationale: The generated page can show the unfinished finalize work while still requiring a remote head match. See the blocked CI fix case in `targeted-after-tier2.log` and the CI fixtures in `targeted-workflow-fixtures.log`.
What breaks if wrong: Committed fixes can be left unpublished, or a failed push can incorrectly become a reportable concern.
Decision pending from the user: None.

## DECIDE-7: Use the existing test files within their line limits

Step: Extend the push, log, and ranking tests.
Question: How should the named integration checks be recorded when their original test files are already near the repository's line limit?
Requirement: Verify the test plan's boundaries in the existing test suites, preserving the repository lint limits and checklist rows.
Decision: Keep the original test files and move related cases that would exceed the limit to the existing finalize suite. Keep the named integration checks and cite the exact case and evidence log for each.
Alternatives: Add a new test file or relax the repository's line limit.
Rationale: The process, temporary Git, fake forge, and workflow fixture boundaries still exercise the same operations. See the relevant cases in `finalize-targeted.log`, `targeted-after-tier2.log`, and `archon-lint.log`.
What breaks if wrong: A reviewer may look in the original test file and overlook the case in the finalize suite, or a file can exceed the repo's lint limit.
Decision pending from the user: None.

## DECIDE-8: Audit: the checker's floor for an unverified row that names a test

Step: Audit of improve-review-page.
Question: May the required-item floor stay red unless the script can match the named test to a direct test command in a passing GitHub Actions job?
Requirement: review-handoff "A script checks the ranking": an unverified row that names an existing test when finalize passed with checks must be at least yellow. "Unverified row has a named test": the item is yellow when a CI suite runs the test.
Decision: No. The narrower floor reinterprets the requirement and is reported as a finding. The script's floor is yellow for an existing named test when finalize passed with checks. Whether a CI suite runs it is the ranker's judgement. This overrides the earlier entry that keeps unproven coverage red.
Alternatives: Keep the conservative matching rule; widen the matcher to more test commands.
Rationale: The matcher skips package-script runners, commands with flags and conditional steps, so it rejects a yellow ranking for a test that CI does run. The approved script rule asks only for an existing test and passing checks.
What breaks if wrong: A row whose named test runs in no CI suite could be ranked yellow if the ranker misjudges it.
Decision pending from the user: None.

## DECIDE-9: Audit: whether a failed log commit is a failed step on the page

Step: Audit of improve-review-page.
Question: The design records a failed log commit as the `logs` step. Does that also make it a red concern and a failed outcome?
Requirement: review-handoff "Log commit fails": the run goes on and the archive commit takes the logs. "Each failed step is a red item" does not list it. pull-request-finalization "Succeeded" depends on acceptance, archive, finalize and the written page.
Decision: No. Keeping the step result satisfies the design. Making it a required red concern that changes the run's state and outcome is reported as a finding.
Alternatives: Treat every recorded step failure as a red concern, including `logs`.
Rationale: This reading satisfies the design and both specs. The pack did not make `logs` a page item before this change.
What breaks if wrong: A later sync whose commit fails would leave entries off the branch with only the step result to show it.
Decision pending from the user: None.

## DECIDE-10: Audit: which passes run sync-logs

Step: Audit of improve-review-page.
Question: Is it compliant to run `sync-logs` only in feedback rounds?
Requirement: design "Logs in feedback rounds": it runs before finalize-push on every pass that runs the tail. INTEG-4: first-pass fixtures do not reach it.
Decision: Yes. Not reported.
Alternatives: Run it on the first pass too.
Rationale: The test plan explicitly keeps it off the first pass, and the design describes it under feedback rounds.
What breaks if wrong: An entry written only to the run's log during first-pass archive or finalize work would reach the committed log only in a later feedback round.
Decision pending from the user: None.

## DECIDE-11: Audit fixes anchor push classification to the hook result

Step: Resolve the push classification finding.
Question: How can the push distinguish a hook failure from the same words in a transport diagnostic?
Requirement: Local hook failures are repairable. Actual network failures use the retry policy.
Decision: Read Git's Trace2 pre-push child result and classify a failing or interrupted hook before reading transport messages. Strip the trace from the diagnostic.
Alternatives: Narrow the error strings or check the hook's filename before pushing.
Rationale: The same network words can appear in hook output. The real hook case and network retry cases are in `audit-targeted-bun.log`.
What breaks if wrong: A local hook can be retried or misrouted to a person, or a transport failure can miss its retries.
Decision pending from the user: None.

## DECIDE-12: Audit fixes preserve the original acceptance round

Step: Resolve the acceptance failure line finding.
Question: How should the original round count align with the page and remain accurate later?
Requirement: The fixed line must describe the actual failed acceptance pass, including after a retest.
Decision: Save the original displayed round number when the failure is recorded. Use one-based display in both the review page and its failure line. Preserve zero-based artifact and comment identifiers.
Alternatives: Display zero-based indexes or derive the count from the latest evidence files.
Rationale: A retest reuses the mutable index file. The original failure count and the newest-first page cases are in `audit-targeted-bun.log`.
What breaks if wrong: Retesting could change the page's description of the original failure or invalidate an evidence comment reference.
Decision pending from the user: None.

## DECIDE-13: Audit fixes preserve an unresolved response in the same round

Step: Resolve the grouped settlement finding.
Question: What happens when multiple answers are recorded under the same source code?
Requirement: Shared answers settle their group, direct responses take precedence, and declined work stays open.
Decision: Within a round, retain any unresolved status when multiple responses have the same source. Apply direct responses after shared status propagation.
Alternatives: Use the last response for a source or change the response record format.
Rationale: A later positive response to another question should not lose explicitly unresolved work. See the grouped and conflicting response cases in `audit-targeted-bun.log`.
What breaks if wrong: A declined concern can disappear, or the reviewer could be asked about work they settled.
Decision pending from the user: None.

## DECIDE-14: Keep required concerns visible after an uncommitted archive

Step: Resolve the before-PR finding on fallback ranking.
Question: How should fallback place a required source that has no GitHub link because the archive is uncommitted?
Requirement: Publish after an ordinary archive failure, preserve required concerns, and allow linkless concerns only for failures with no committed source.
Decision: In deterministic placement, remove unresolved required links. Fold items that have no remaining link into the existing archive failure, with their titles, status and sources.
Alternatives: Permit any linkless concern, use an uncommitted link, or omit the concerns.
Rationale: The archive failure explains why those sources are unavailable. Its combined concern retains the required sources while the strict checker still requires links for ordinary items. See the uncommitted archive fallback case in `before-pr-review-unit.log`.
What breaks if wrong: The page could fail again during fallback, or independent concerns could lose their details or become harder to review.
Decision pending from the user: None.

## DECIDE-15: Keep the first valid command entry for an output path

Step: Resolve the before-PR command evidence finding.
Question: How should the publisher handle repeated output paths within one manifest?
Requirement: A command entry's identity is its output path. References and comments must resolve to one entry.
Decision: Keep the first valid entry for that path, report later collisions, and have the tester save a separate output file for each entry.
Alternatives: Add a manifest index to every existing command identifier, or reject all entries that share a path.
Rationale: This preserves existing references and keeps the output path as the identity. See the duplicate output case in `before-pr-review-unit.log`.
What breaks if wrong: A repeat entry could replace the excerpt still referenced by a concern, or a comment could attach to another excerpt.
Decision pending from the user: None.

## DECIDE-16: Keep unavailable archive sources out of shared settlement

Step: Resolve before-PR review finding REVIEW-8.
Question: How should the archived review page settle a source displayed under the archive failure solely because its link is unavailable?
Requirement: Keep required concerns visible and settle grouped sources together only when they share the answered question.
Decision: Store the IDs of those sources on the combined concern and exclude them from the archive's shared answer. An individually sourced question, such as a spec-change dispute question, still takes its own answer.
Alternatives: Permit separate linkless non-failure concerns, or give the archive answer authority over all the displayed sources.
Rationale: Displaying missing links together preserves publication and makes the incomplete archive visible. It does not make the underlying decisions or disputes consequences of the archive failure. See the archive settlement regression in `before-pr-review-round-2-unit.log`.
What breaks if wrong: Fixing the archive could reopen or silently dismiss an unrelated required source.
Decision pending from the user: None.

## DECIDE-17: Preserve the identity of log entries copied before a failed commit

Step: Resolve before-PR review finding REVIEW-9.
Question: How can a retry recognize a copied entry whose title or body changed after the archive committed it?
Requirement: Retry source entries absent from the change folder, preserve existing edits and settlements, and advance the synced count only when the content is committed.
Decision: Record the stable numbered IDs assigned when the first pass writes the log files, independently of committed counts. Later sync recognizes a surviving ID even after an edit and adds a missing copy when needed.
Alternatives: Use the whole entry or its heading as identity, or mark all written entries as committed.
Rationale: The assigned ID stays stable when a reviewer edits or settles the entry. See the log retry tests in `before-pr-review-round-2-unit.log`.
What breaks if wrong: A settled decision could appear under a new code, or a missing entry could fail to make it onto the branch.
Decision pending from the user: None.

## DECIDE-18: Review finding REVIEW-3, before the pull request: A failed log sync never appears on the review page

- Question: Is this a defect that must be fixed before the change is accepted? What can fail: the new `sync-logs` commit, for example because of a hook rejection or git error.

What happens: `syncLogs` restores the original files, records a `logs` step failure and returns `ok:false`. No workflow node reads that output, and `finalize-push` runs anyway. The `failures` map used by `stepFailures` has no `logs` key.

Gap: `logItems` reads the restored change-folder logs, so decisions and disputes added this round, including possible spec-change disputes from the run log, are missing from the concerns. The page can still say the run succeeded and offer Merge, with no sign that entries were dropped. (factory-workflows/archon/.archon/workflows/codagent/.shared/lib/review-inventory.ts:80, medium error-handling)
- Requirement: the error-handling review instructions.
- Step: before the pull request review handoff.
- Decision: Declined to fix: The approved design and prior audit keep log sync failures in the run diagnostics. A red concern would change the approved run outcome, and unsynced entries have no committed GitHub source. The reviewer accepted it.
- Alternatives: fix or leave the finding open.
- What breaks if wrong: What can fail: the new `sync-logs` commit, for example because of a hook rejection or git error.

What happens: `syncLogs` restores the original files, records a `logs` step failure and returns `ok:false`. No workflow node reads that output, and `finalize-push` runs anyway. The `failures` map used by `stepFailures` has no `logs` key.

Gap: `logItems` reads the restored change-folder logs, so decisions and disputes added this round, including possible spec-change disputes from the run log, are missing from the concerns. The page can still say the run succeeded and offer Merge, with no sign that entries were dropped.
- Rationale: What can fail: the new `sync-logs` commit, for example because of a hook rejection or git error.

What happens: `syncLogs` restores the original files, records a `logs` step failure and returns `ok:false`. No workflow node reads that output, and `finalize-push` runs anyway. The `failures` map used by `stepFailures` has no `logs` key.

Gap: `logItems` reads the restored change-folder logs, so decisions and disputes added this round, including possible spec-change disputes from the run log, are missing from the concerns. The page can still say the run succeeded and offer Merge, with no sign that entries were dropped.; suggested fix: Add `logs: ['The review logs were not committed', 'Some decisions or disputes from this run may be missing from this page.']` to `failures`, so it becomes a red concern. Update the rank-review expectations and tests to match. Alternatively, include the unsynced run-log entries in the inventory.; fixer declined: The approved design and prior audit keep log sync failures in the run diagnostics. A red concern would change the approved run outcome, and unsynced entries have no committed GitHub source.; reviewer accepted: The code before this change also left `logs` out of the page's failure list, so showing log failures only in run diagnostics is existing behavior. I did not check the fixer's design citation. With the REVIEW-2 fix, a failed sync keeps its entries and leaves the counts unchanged, so a later sync can retry them. The remaining risk is that the current round's page omits them.. Result: review/before-pr.md

## DECIDE-19: ACCEPT-1 and ACCEPT-2 — Keep the complete screenshot and revision accessible

- **Step** — Acceptance round index 0 findings.
- **Question** — How should an oversized screenshot enter full-size mode, and how should a reviewed revision fit on a phone?
- **Requirement** — The review page opens screenshots at full size and shows the reviewed head in the header.
- **Decision** — Anchor the natural-size image at the start of a bounded scroll area and reset the pan position on fit mode changes. Let the full reviewed revision wrap inside its metadata row.
- **Alternatives** — Use a separate natural-size image tab, retain the previous pan position across mode changes, or abbreviate the revision on narrow displays.
- **Rationale** — The same dialog retains the image controls and comments. Resetting fit mode avoids carrying a previous offset into the next view. Wrapping preserves the exact revision. The viewer component case and full-SHA header case passed in `acceptance-round-0-unit.log`. The layout rules are recorded in `acceptance-round-0-layout-inspection.log`.
- **What breaks if wrong** — If the dialog still lays out the natural-size image outside the scrollable origin, panning the 2200×1300 screenshot in the tester's 1200 px viewport still loses an edge. If the header's flex rows cannot shrink, the 390 px viewport still clips the final characters. The component tests cannot measure those bounds.
- **Regression recommendation** — A browser regression should measure both screenshot edges at the two scroll limits and assert that the reviewed revision stays within the 390 px viewport. The pack's existing integration cases render through a simulated DOM, and the approved plan has no browser automation harness. Adding a browser dependency or new suite falls outside this change.
- **Decision pending from the user** — None.

## DECIDE-20: ACCEPT-3 — Journey manifest contract and Retest scope

- **Step** — Acceptance round index 0 finding.
- **Question** — Which journey data must the tester produce, and should the review page offer every recorded journey for individual Retest?
- **Requirement** — The ranking can list recorded journeys for a Late commit. Choosing Retest reruns the journeys listed for the answered item. The design gives each acceptance evidence round a recap.
- **Decision** — Require the producer to write and read back the exact string fields the consumer reads, including `repeat`. Preserve the approved Late commit flow. Keep the recorded scenario and repeat steps available to the Retest agent.
- **Alternatives** — Accept alternate field names, add a separate visual list of every scenario and repeat step, or make every recorded journey independently selectable.
- **Rationale** — The tester reported missing `repeat` on all four entries. The prior prompt described “repeat instructions” without specifying that key. The manifest now on disk has all four expected string fields in every entry, so it cannot identify the spelling that led to the original rejection. See `acceptance-round-0-manifest-inspection.log`. The canonical and incomplete manifest paths passed in `acceptance-round-0-unit.log`. The existing publish-to-Retest integration case now asserts that the selected journey's scenario and repeat steps survive publication and feedback. This step did not run that integration case.
- **What breaks if wrong** — If a live tester still writes a different key, the media reader drops those records and the ranker cannot attach them to a Retest question. A page with no Late commit that affects a recorded journey will have no Retest option under the current spec.
- **Decision pending from the user** — Decide whether to extend the approved behavior to display every scenario and its repeat steps on the page and offer individual Retest outside a Late commit item. The acceptance finding requests that broader flow, while the approved spec and mockup define an item-level Retest.

## DECIDE-21: Preserve committed log identities during synchronization

- **Step** — Fix pull request review findings in finalize.
- **Question** — How should synchronization handle a committed entry missing from the worktree copy?
- **Requirement** — New entries receive numbers after the highest existing ID, and review links and responses refer to entries by ID.
- **Decision** — Restore missing committed entries with their original codes and numbering. Assign new IDs above the combined log's maximum only to new entries. Keep the worktree version of entries whose code is already present.
- **Alternatives** — Rebuild the entire log from HEAD, or feed restored entries through new-entry numbering.
- **Rationale** — Restoring by code preserves existing links and keeps any worktree settlement or edit on a surviving entry. The regression restored DECIDE-1 and assigned DECIDE-3 to the new entry. See `fix-pr-targeted.log`.
- **What breaks if wrong** — Renumbering a restored decision breaks saved links and can re-open a decision previously settled under its original code.

## DECIDE-22: Exclude documentation citations from the named-test minimum

- **Step** — Fix pull request review findings in finalize.
- **Question** — How should the checker distinguish test paths from documentation cited as evidence?
- **Requirement** — The checker permits yellow for an existing named test when finalize passed with checks. The ranker separately judges whether a passing CI suite ran it.
- **Decision** — Exclude documentation extensions before matching test paths and checking whether they are committed. Keep the existing test path conventions for other formats.
- **Alternatives** — Exclude only test-plan.md, or limit test paths to an explicit list of implementation languages.
- **Rationale** — A format check covers plans and prose under test directories while preserving paths used by different test runners. The committed Markdown test plan stayed red, and Bun, Python and Go test paths remained eligible. See `fix-pr-targeted.log`.
- **What breaks if wrong** — A documentation extension used by an executable literate test loses the lighter checker minimum. A prose format outside the filter could still pass the name check, so the ranker's CI judgment remains necessary.

## DECIDE-23: Validate shared questions on grouped concerns

- **Step** — Fix pull request review findings in finalize.
- **Question** — What question must remain for a source grouped with a dedicated spec-change dispute?
- **Requirement** — A source with a dedicated question uses its own answer, and remaining sources share the remaining questions.
- **Decision** — Reject dispute-only questions when another source needs a shared answer. Keep the existing rule that a valid source-less Retest question can serve that role when journeys exist.
- **Alternatives** — Let the dispute-only ranking pass, or require an additional generic question even when Retest already provides a shared answer.
- **Rationale** — Validation now matches fallback and the review page's binding. The grouped decision regression and the existing grouped Retest case passed in `fix-pr-targeted.log`. The check diagnostic reached the repair step in `fix-pr-ranking-fixture.log`.
- **What breaks if wrong** — A grouped decision can remain open because the page has no question for its source, or the page can demand an extra answer before sending feedback.
