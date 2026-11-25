## D-01: Review workflow guards and dry-run wait assertion

- Step: Wire and test the review loop.
- Question: How should the loop express shared eligibility in Archon's condition syntax and verify that the only terminal wait was reached?
- Requirement: First, feedback, refused, terminal and stale passes follow the approved paths. A successful first publish pauses in the durable wait.
- Decision: Have start-round supply boolean gates derived from mode. Assert a paused fixture outcome with no wait stub, after requiring the completed publish node. The fixture runner's reached list counts only completed nodes.
- Alternatives: Repeat disjunctions in every node, or require the paused wait in the fixture's reached list.
- Rationale: The fork's workflow validator rejects grouping parentheses, and the trace shows the wait paused even when the reached assertion rejected the fixture. The current graph has one review wait. Saved outputs are evidence/feedback-routing-bringup.log and evidence/I-1.log.
- What breaks if it is wrong: The workflow will reject or route a pass incorrectly, or the fixture could mistake another pause for the intended one if another wait is introduced.
- Pending decision from the user: None.

## D-02: Preserve archive ownership across feedback retries

- Step: Retry an unfinished archive.
- Question: Should spec changes staged by a failed archive commit be treated as pre-existing local spec edits on the next attempt?
- Requirement: A feedback retry uses a fresh baseline at the round head and keeps earlier archive paths as the attempt's own work.
- Decision: Carry forward earlier owned paths and exempt them from local spec suspension, preserving the earlier attempt and patch metadata in its own folder.
- Alternatives: Reclassify all staged changes as local to the new attempt, or restart the archive by deleting its incomplete work.
- Rationale: The former preserved the archive's changes outside its commit and failed verification, as shown in evidence/archive-retry-before-owned-path-fix.log. Deleting incomplete work would lose the archived delta material. The current fix is checked in evidence/I-27.log.
- What breaks if it is wrong: The retry either keeps owned edits uncommitted or includes unrelated staged changes.
- Pending decision from the user: None.

## D-03: Classify refusals using the current pull request

- Step: Implement and verify merge handling.
- Question: How should the run distinguish a moved head or conflict from a repository-rule refusal when the forge returns only a generic HTTP status?
- Requirement: Start a new round for a moved head or conflict. Read back ambiguous writes, and re-ask on repository rules.
- Decision: Read back the numbered PR after a refusal, compare its head to the reviewed head, and check merge state on low-information 405 or 409 responses or a generic decline. Record whether a new pass is needed on the page index so resuming preserves the branch.
- Alternatives: Infer the category from every raw HTTP status, or treat all refusals as new rounds.
- Rationale: GitHub's pinned adapter gives a generic HTTP status for some definitive refusals. The numbered read-back distinguishes an applied merge, closure, a moved head and unchanged open PR. See evidence/I-22.log.
- What breaks if it is wrong: A policy refusal could start an unwanted pass, or a genuine conflict could leave a reviewer on the same stale round.
- Pending decision from the user: None.

## D-04: Retest coverage follows the item that was answered

- Step: Wire Retest into the feedback round.
- Question: What should happen when the ranker shows more than one Late commit item with journeys and the reviewer chooses Retest on only one?
- Requirement: Rerun the listed journeys and clear the earlier commits that the page listed after the retest passes.
- Decision: Save each journey's source item codes and commits with the page. Rerun just the entries for items whose Retest option was chosen, and clear that item's listed commits on success. Keep commits made in the same feedback round.
- Alternatives: Rerun all journeys mentioned anywhere on the review page, or clear only the individual journey's representative commit.
- Rationale: This follows the scoped choice made under the item's question and preserves visibility for other items. The focused coverage is in evidence/retest-selection-targeted.log.
- What breaks if it is wrong: Unselected work could be retested or dismissed, or selected commits could stay on the next page.
- Pending decision from the user: None.

## D-05: Keep the eval wait setting compatible with the baseline

- Step: Integrate the evaluation harness.
- Question: How should the harness disable the wait when it runs different pack refs?
- Requirement: Review waits default on for people. Eval runs continue to end as they did before.
- Decision: Add review_wait=false to the agent-evals defaults that already filter values by the loaded pack's declared settings. Keep the change on a separate harness branch.
- Alternatives: Pass the input to every pack ref, or require each harness caller to set it.
- Rationale: Older packs reject undeclared inputs. The existing setting filter preserves old launches, and the targeted compatibility and launch tests passed in evidence/harness-review-wait.log.
- What breaks if it is wrong: Older pack evals could reject launch inputs or finish-mode reps could stay paused for review.
- Pending decision from the user: None.

## D-06: Audit: which revisions a feedback round's review covers

- Step: Audit.
- Question: Should a feedback round's first review start at the head the page showed, or at the last reviewed revision?
- Requirement: change-review, "A review cycle keeps one reviewer session" (Feedback round review) says it covers what changed since the last reviewed revision. design.md, "A feedback round", says it covers the round's own commits since the head its page showed.
- Decision: Accept the implementation, which follows design.md. Not reported as a finding.
- Alternatives: Report it, and require the range to start at the last reviewed revision, which would also cover earlier finalize fixes and other commits made after the last review.
- Rationale: design.md states the range precisely for this change, and the first pass does not review finalize's fixes after its last review either.
- What breaks if it is wrong: Product commits made between the last review and the page's head, such as finalize's CI fixes, are never reviewed.
- Pending decision from the user: None.

## D-07: Audit: the page after a repository-rules refusal

- Step: Audit.
- Question: May the page become a read-only record when its Merge was refused for the repository's rules and the run waits on the same round again?
- Requirement: review-response, "The run handles each merge outcome" (ask again, start no round); review-page, "An answered page is a read-only record".
- Decision: Accept it. The run recorded an answer from that page, so the page is locked. The renewed wait can be answered from the Archon CLI or UI. Not reported as a finding.
- Alternatives: Require the page to reopen its buttons after a rules refusal.
- Rationale: The record requirement applies to every answer the run receives, and neither requirement gives an exception for a refused merge.
- What breaks if it is wrong: After adding a missing approval, the reviewer cannot choose Merge again from the page.
- Pending decision from the user: None.

## D-08: Audit: how long a retest failure stays on the page

- Step: Audit.
- Question: Should a later round with no retest keep showing an earlier failed retest?
- Requirement: review-response, "A failed retest is a red item"; design.md, "Recording an answer", which clears the round steps' entries and keeps acceptance and archive entries.
- Decision: Accept keeping the retest failure until a retest passes. Repeating the old retest result in later round recaps is reported separately.
- Alternatives: Treat the retest entry as a round step entry and clear it at the next round.
- Rationale: A failed retest is an acceptance failure, and an acceptance failure stays until an acceptance round passes.
- What breaks if it is wrong: A red item stays on later pages after the definition would have removed it.
- Pending decision from the user: None.

## D-09: Audit: failed-step items in the ranking check

- Step: Audit.
- Question: May the ranking check skip its requirement for failed-step items, which the publisher inserts itself?
- Requirement: review-handoff, "A script checks the ranking" and "Each failed step is a red item".
- Decision: Accept a ranking that omits a failed-step item, since the publisher always adds it. Do not accept that a ranker item carrying the same failure code can replace the standard item or sit below red; that is reported as a finding.
- Alternatives: Require the ranker to supply every failed-step item, or report the whole skip.
- Rationale: The publisher's insertion meets the requirement for an omitted item. It does not meet it when it defers to the ranker's own item.
- What breaks if it is wrong: The check would be weaker than the definition asks for omitted failures.
- Pending decision from the user: None.

## D-10: Carry free-form finding requests through the feedback response

- Step: Resolve audit finding 4.
- Question: How should Other, notes, plain text and custom options identify a logged finding for re-review?
- Requirement: Re-review a logged finding when the reviewer's answer asks for a fix.
- Decision: Ask the implementor to record requested finding IDs in its structured response, and let review preparation reopen matching previously handed-off findings. Keep direct support for the standard fix option and resolve it through both logs.
- Alternatives: Infer intent by matching words in the user's text, or reopen every finding cited by the answer.
- Rationale: The implementor already interprets feedback in context. An explicit ID lets the reviewer revisit the requested finding without treating a mention or decline as a fix request. Evidence is in evidence/audit-I-35.log.
- What breaks if it is wrong: A requested fix could go unreviewed, or an unrelated previously settled finding could reopen.
- Pending decision from the user: None.

## D-11: Keep publisher-owned failure items authoritative

- Step: Resolve audit finding 11.
- Question: How should a ranker item that uses a reserved failure source coexist with the canonical failed-step item?
- Requirement: Every failed step has a standard red item and question, with consistent state counts.
- Decision: Reject reserved failure sources in the ranker's output. During deterministic placement, remove those sources while preserving any other symptoms. Publish canonical failure items and calculate both counts from the same filtered ranking.
- Alternatives: Let the ranker replace the canonical failure, or discard an entire mixed item regardless of its other sources.
- Rationale: Step failures need the standard decision path, and symptoms associated with valid source IDs still belong in the review. Evidence is in evidence/audit-I-43.log and evidence/audit-I-61.log.
- What breaks if it is wrong: The review could omit the standard repair question, duplicate a failure, or omit an independent symptom.
- Pending decision from the user: None.

## D-12: Recover a missing ranking from the required inventory

- Step: Before-PR review, cycle 0, R2.
- Question: What can publication do if the checked or placed ranking never reached disk?
- Requirement: The review-handoff ranking check requires an independent inventory and deterministic placement when repair cannot pass.
- Decision: Rebuild required items from the inventory if it can be read and placed. Fail publication when required items cannot be determined. The stale wait uses the existing page.
- Alternatives: Always stop when the checked ranking is missing, or publish an empty ranking with a generic failure item.
- Rationale: Independent placement keeps mandatory evidence in view after a recoverable failure. An unreadable inventory cannot support a trustworthy new page.
- What breaks if it is wrong: A failed placement with a readable inventory may publish a page without discretionary agent items. A malformed checklist stops publication instead of yielding an attention page.
- Evidence: `before-pr-cycle-0-unit.log`, “publication rebuilds missing ranking from required items and refuses an unreadable inventory.”
- Pending decision from the user: None.

## D-13: Include PR-head imports in the first-parent review range

- Step: Before-PR review, cycle 0, R3.
- Question: Does the first-parent walk exclude commits introduced by a merge of the PR head during a wait?
- Requirement: The design starts with first-parent history and excludes clean base merges. Review-handoff requires commits after the accepted head to be ranked, and feedback review covers round changes.
- Decision: Walk first-parent merges in both consumers and add commits reachable from merged parents that the starting revision and fetched base ref do not already cover. Keep merge resolution diffs.
- Alternatives: Inspect only the first-parent merge, or walk all ancestors without excluding base.
- Rationale: The relevant distinction is whether the merge imported product work absent from the reviewed head and base. A clean merge can introduce that work with no remerge diff.
- What breaks if it is wrong: If the base ref recorded by merge-base does not describe the imported base history, the shared walker can list base-only files and commits or omit a PR commit now reachable from that ref.
- Evidence: `before-pr-cycle-0-unit.log`, “clean PR-head imports reach the late inventory and feedback files without imported base work.”
- Pending decision from the user: None.

## D-14: Separate archive location from archive success

- Step: Before-PR review, cycle 0, R5.
- Question: Which folder should a feedback round use after the move succeeds and the archive commit or verification fails?
- Requirement: Later log entries belong to the retained change folder. An unfinished archive must retry and continue to gate Merge.
- Decision: Resolve an existing active folder or the unique matching archive folder in both consumers. The unsuccessful archive still needs a retry.
- Alternatives: Take the archive report as authoritative only after success, or treat finding an archived folder as success.
- Rationale: Directory location can change before the archive outcome is known. Creating an active directory for feedback would compromise repair of the original move.
- What breaks if it is wrong: A stale but unique dated directory could receive feedback meant for a missing active change. When there are two matches the resolver retains the active path and the ambiguous archive remains blocked.
- Evidence: `before-pr-cycle-0-unit.log`, “a moved but unsuccessful archive keeps the archived folder for feedback and remains pending.”
- Pending decision from the user: None.

## D-15: Bind each grouped dispute question to its source

- Step: Before-PR review, cycle 0, R6.
- Question: How should grouped spec-change disputes retain distinct approval choices?
- Requirement: Group common causes into one item, and offer only the choices allowed by each spec-change dispute.
- Decision: A grouped item has one question per dispute, in source order, with the answer bound to that dispute code. A Retest question follows when applicable.
- Alternatives: Split the shared item, or combine choices into one question.
- Rationale: Grouping still describes the shared symptom once. Separate source-bound answers avoid applying one dispute's edit to another.
- What breaks if it is wrong: A ranker that generates its questions in a different order gets a repair request. Without the binding, choosing a later dispute's edit would target the first source in the group.
- Evidence: `before-pr-cycle-0-unit.log`, “grouped spec-change disputes keep separate exact questions and answer sources” and “placing a dispute grouped with a late commit retains a separate Retest question.”
- Pending decision from the user: None.

## D-16: Keep still-failed checklist rows in the required inventory

- Step: Before-PR review, cycle 0, R7.
- Question: Can the response dismiss work which the checklist still records as failed?
- Requirement: Review-handoff explicitly requires failed checklist rows. The design dismisses answers that close an item and require no more work.
- Decision: Define statuses in the feedback command and keep failed checklist rows in the required inventory until their checklist status changes.
- Alternatives: Trust the response status for every checklist row, or introduce an explicit new waiver option.
- Rationale: A leave-for-reviewer answer does not resolve a failure. A waiver option would change the approved answer behavior.
- What breaks if it is wrong: A reviewer intentionally leaving a failure will see it again until the checklist changes. Incorrectly treating it as resolved would hide it from later pages.
- Evidence: `before-pr-cycle-0-unit.log`, “a no-change response cannot dismiss a checklist failure that still needs work.”
- Pending decision from the user: None.

## D-17: Report malformed evidence while retaining valid entries

- Step: Before-PR review, cycle 0, R8.
- Question: How should ranking proceed when an acceptance evidence manifest cannot be fully read?
- Requirement: Review-handoff shows recorded evidence and visible failures with cause and remaining work. The design does not define a malformed-manifest policy.
- Decision: Retain records with all required string fields, collect file-specific problems into a standard red evidence item, and keep archive and finalize as the Merge gates.
- Alternatives: Silently skip bad evidence, reject the entire inventory, or make a new Merge gate.
- Rationale: Valid data still helps the reviewer. The evidence gap is visible and repairable without inventing a gate or repeatedly failing the ranking schema.
- What breaks if it is wrong: A tester emitting a partial journey record loses that journey's Retest option until the manifest is repaired. A reviewer can still proceed after seeing the red evidence item.
- Evidence: `before-pr-cycle-0-unit.log`, “invalid evidence manifests preserve usable entries and become a named review failure.”
- Pending decision from the user: None.

## D-18: Pass the feedback reviewer its exact product revisions

- Step: Before-PR review, cycle 0, second fix turn, R3.
- Question: Should the feedback reviewer discover imported commits itself or consume the revision walk already used for its file list?
- Requirement: Feedback review covers changes introduced in the round, including imported PR work and merge resolutions but excluding imported base changes.
- Decision: Pass the ordered revisions and affected files from the same scope calculation. Include revisions with product diffs, using remerge diffs for merges.
- Alternatives: Tell the reviewer to reconstruct the commit selection from the start and base refs.
- Rationale: One scope calculation keeps review instructions, changed files and the set of imported commits aligned.
- What breaks if it is wrong: If the workflow loses the revisions binding, the reviewer will see files without commits and may skip the imported work. If a merge with a product resolution is filtered out, review will miss the resolution.
- Evidence: `before-pr-turn-1-unit.log`, “clean PR-head imports reach the late inventory and feedback files without imported base work,” and `before-pr-turn-1-inspection.log`.
- Pending decision from the user: None.

## D-19: Treat an empty screenshot round as optional evidence

- Step: Before-PR review, cycle 0, second fix turn, R9.
- Question: Does a missing screenshot manifest represent an error if the tester captured no supported images?
- Requirement: The page has no screenshot section for a run without screenshots. The tester writes a manifest for screenshots it captures.
- Decision: A round without a manifest and without supported image files is valid. A missing manifest alongside supported images still produces a file-specific evidence problem.
- Alternatives: Treat every missing manifest as a failure, or ignore missing manifests even when images exist.
- Rationale: The presence of a folder does not establish that the tester captured screenshots.
- What breaks if it is wrong: The screenshot extension check could silently treat an unsupported format as absent evidence. A supported image without a manifest is reported and cannot be selected or shown until it is described.
- Evidence: `before-pr-turn-1-unit.log`, “missing screenshot manifests are reported only when a round contains a supported image.”
- Pending decision from the user: None.

## D-20: Review finding R4, before the pull request: After a rules refusal the page is read-only, so Merge cannot be retried there

- Question: Is this a defect that must be fixed before the change is accepted? mergeAnswer writes the merge into the page's `sent-answers` block before calling the forge. If the forge refuses for repository rules, such as a missing approval, the run returns `stale` and waits on the same page without rendering it again. review-page.js treats any non-empty block as final: fields are disabled and there are no Send or Merge buttons. After getting the approval, the reviewer cannot merge or send feedback from the page the wait points to. Only the CLI or UI still works. (factory-workflows/archon/.archon/workflows/codagent/.shared/lib/review-round.ts:197, medium quality)
- Requirement: the quality review instructions.
- Step: before the pull request review handoff.
- Decision: Declined to fix: The approved spec requires an answered page to remain a read-only record. After a repository-rules refusal, the same round can receive another answer through the Archon CLI or UI. The reviewer accepted it.
- Alternatives: fix or leave the finding open.
- What breaks if wrong: mergeAnswer writes the merge into the page's `sent-answers` block before calling the forge. If the forge refuses for repository rules, such as a missing approval, the run returns `stale` and waits on the same page without rendering it again. review-page.js treats any non-empty block as final: fields are disabled and there are no Send or Merge buttons. After getting the approval, the reviewer cannot merge or send feedback from the page the wait points to. Only the CLI or UI still works.
- Rationale: mergeAnswer writes the merge into the page's `sent-answers` block before calling the forge. If the forge refuses for repository rules, such as a missing approval, the run returns `stale` and waits on the same page without rendering it again. review-page.js treats any non-empty block as final: fields are disabled and there are no Send or Merge buttons. After getting the approval, the reviewer cannot merge or send feedback from the page the wait points to. Only the CLI or UI still works.; suggested fix: Keep the saved answer file as the record. When handleRefusal ends in `stale`, rewrite the current page and review-page.html with an empty sent block (`sentBlock(null)`). Preferably also embed the refusal reason and history so the page stays answerable.; fixer declined: The approved spec requires an answered page to remain a read-only record. After a repository-rules refusal, the same round can receive another answer through the Archon CLI or UI.; reviewer accepted: The approved review-page spec, 'An answered page is a read-only record', says that once the run receives an answer, the page shows it with every input locked and no buttons. That includes a page where Merge was chosen. Clearing the sent block after a rules refusal would break this. The same round still accepts a later answer through the CLI or UI.. Result: review/before-pr.md
- Pending decision: None, unless you disagree with the decline.

## D-21: Prepare an isolated Archon after acceptance round 0 could not start

- Step: Acceptance triage, round index 0.
- Question: How can acceptance proceed when the required isolated Archon instance was unavailable?
- Requirement: The acceptance envelope uses the fork with the review-page support and an Archon instance with its own home and port. The acceptance pass starts and stops that instance.
- Decision: Prepared a scratch checkout at the exact CI pin, `55559e35f2faa64c016d99f03f441b3bba02b769`, installed its locked dependencies and built its UI. Verified that the server boots on loopback and serves an independent SQLite store. Stopped the preflight instance and removed its home so the tester can start its own.
- Alternatives: Use the installed CLI and default home, or ask the tester to build the fork during the next pass.
- Rationale: The pinned source matches the pack's engine prerequisite. Preparing and verifying it removes the environmental blocker without changing approved behavior.
- What breaks if it is wrong: If the next pass cannot access the scratch checkout on this host, it cannot start the prepared service and must rebuild the CI pin before accepting the change.
- Evidence: `acceptance-round-0-archon-setup.log` and `acceptance-round-0-archon-boot.log`.
- Pending decision from the user: None.

## D-22: Guard against dispatch to the shared installation

- Step: Acceptance triage, round index 0.
- Question: How can the tester avoid repeating the dispatch to the shared installation?
- Requirement: Shared Archon and its runs are outside the acceptance envelope.
- Decision: Added a run-local launcher for the pinned source that requires a scratch home and an explicit server port. It refuses a missing home or a home outside the scratch location before invoking Archon. The tester reports cancelling the misdirected run, so no further action on shared state was taken.
- Alternatives: Rely on unguarded PATH commands or inspect the shared run after the tester reported cancellation.
- Rationale: The launcher guards the actual CLI invocation and can also be passed as the live-trial helper's ARCHON command.
- What breaks if it is wrong: A tester who bypasses the launcher can still invoke the system CLI against a shared home. Keep all acceptance-side commands, including detached dispatches through live-trial, on the verified launcher and home.
- Evidence: `acceptance-round-0-archon-isolation.log` and `acceptance-round-0-archon-boot.log`.
- Pending decision from the user: None.

## D-23: Correct the review script schema assertion that blocked CI

- Step: Acceptance triage, round index 1.
- Question: Did the nine INT-009 failures come from the workflow output or the test checker?
- Requirement: The feedback review receives its revision list. The shared output schema allows other review modes to omit that list, requires the original output fields and forbids undeclared fields.
- Decision: Fixed the test checker in commit `3e21158` so it requires fields listed in `required`, rejects unknown fields and validates the types of fields that are present. Product output and workflow schemas stayed as approved.
- Alternatives: Emit empty `revisions` from other review modes, or relax the checker to accept undeclared fields.
- Rationale: The CI stack traces all show the same failure at the exact-key assertion in `checkOutput`. The old checker required every property even though `revisions` is optional. The unit regression covers both valid shapes and rejection of missing required, mistyped and undeclared fields.
- What breaks if it is wrong: If an integration case has another failure beyond the schema assertion, the next CI run will expose it once the assertion no longer aborts the case.
- Regression coverage: INT-009 already exercises the real review scripts across initial, tail and acceptance modes. It should remain the CI regression for this flow. A separate end-to-end test would duplicate the existing failure boundary. The local verification ran affected unit tests only.
- Evidence: `acceptance-round-1-ci-schema-diagnosis.log`, `acceptance-round-1-schema-unit.log`, `acceptance-round-1-openspec.log`, and `acceptance-round-1-checklist.log`.
- Pending decision from the user: None.

## D-24: Refuse archive retries with mixed spec changes

- Step: PR finalization.
- Question: How can a retry distinguish prior archive edits from work added later to the same file?
- Requirement: Retain the failed attempt's owned changes and preserve unrelated index and worktree edits.
- Decision: Fingerprint each dirty owned spec in both layers and refuse to retry when its current layers cannot be matched to the previous attempt. Preserve both layers and name the file in the failure.
- Alternatives: Attempt an automatic split of overlapping changes or commit the whole path.
- Rationale: The fingerprints establish what can be reused. They cannot determine who owns overlapping edits.
- What breaks if it is wrong: Divergent edits may block a retry that a person could separate. Accepting a changed layer could commit unrelated work.
- Evidence: `fix-pr-targeted.log`, “archive retry refuses later staged edits to a previously owned spec without changing either layer” and the unstaged counterpart.
- Pending decision from the user: None.

## D-25: Keep incomplete spec restoration active

- Step: PR finalization.
- Question: What should retry do when restoration previously failed?
- Requirement: Preserve the original staged and unstaged changes, and report a failed archive when restoration remains unresolved.
- Decision: Retain the active patch record through retry, and fail early if a previous restoration error is still recorded.
- Alternatives: Drop the active record after backing it up, or reapply patches after a partial restoration.
- Rationale: Backup alone is insufficient, and blindly reapplying partially restored patches could duplicate edits.
- What breaks if it is wrong: An unresolved record may require manual recovery before another attempt. Dropping it may allow premature archive success.
- Evidence: `fix-pr-targeted.log`, “INT-008 conflicting spec restoration fails verification and retains original patches.”
- Pending decision from the user: None.

## D-26: Preflight the head condition advertised by the forge

- Step: PR finalization.
- Question: Where should a wait-enabled run reject a plugin that cannot enforce the merge head?
- Requirement: Merge must be conditioned on the reviewed head, and preflight must report missing forge support before agent work.
- Decision: After the existing credential and operation preflight succeeds, check the selected host's discovery metadata for the head condition. Wait-off keeps its original preflight.
- Alternatives: Wait for merge dispatch to reject the operation, or expand Archon's check protocol.
- Rationale: The pinned CLI already provides the metadata without contacting the forge.
- What breaks if it is wrong: A plugin without usable metadata cannot be used for a wait-enabled run, even if it claims merge support.
- Evidence: `fix-pr-targeted.log`, “wait-enabled forge preflight checks declared merge conditions.”
- Pending decision from the user: None.

## D-27: Use the recorded PR base for the initial late-commit walk

- Step: PR finalization.
- Question: How should a walk identify base imports when a round has never written merge targets?
- Requirement: Show imported PR work and exclude commits already on the base.
- Decision: Prefer the fetched target when present. Otherwise resolve the PR's recorded base on the push remote. Keep first-parent traversal when no base is known.
- Alternatives: Walk every parent with no base exclusion, or require a feedback round before listing imported commits.
- Rationale: The recorded PR supplies the same distinction before the first wait without a new forge call.
- What breaks if it is wrong: An absent local base ref still limits the walk to first-parent history. A stale base record can misclassify imported commits until synchronization.
- Evidence: `fix-pr-targeted.log`, “clean PR-head imports stay visible using recorded pull request without imported base work.”
- Pending decision from the user: None.

## D-28: Publish synchronization failures without applying feedback

- Step: PR finalization.
- Question: Which work can continue if neither synchronization path succeeds?
- Requirement: Merge current branch tips before applying feedback. Show failures as red items and still publish and wait.
- Decision: Only run the feedback implementor after a clean synchronization or successful conflict repair. The guarded tail can still publish the recorded failure.
- Alternatives: Apply feedback against the old branch, or stop before writing a review page.
- Rationale: Applying feedback to a stale base would violate the round ordering. A published failure lets the reviewer see the cause.
- What breaks if it is wrong: A successful clean or repaired synchronization could omit feedback if its success output is lost.
- Evidence: `fix-pr-fixtures.log`, feedback-fetch-failed, feedback-merge-failed, feedback-conflict, and feedback-round.
- Pending decision from the user: None.

## D-29: Choose the edit target after a partial archive transition

- Step: PR finalization.
- Question: Which spec should receive a selected edit after OpenSpec moved the change, but archive commit or verification failed?
- Requirement: The design uses the delta before a passing archive; the spec directs edits to the canonical spec after archival and preserves the archived delta.
- Decision: Leave the existing rule in place and flag the conflict for acceptance or planning.
- Alternatives: Treat the successful move as the boundary and edit the canonical spec, or reapply OpenSpec to an edited delta during retry.
- Rationale: Both alternatives change the approved retry or edit behavior. They also interact with preserving unrelated changes in an outstanding archive attempt.
- What breaks if it is wrong: The current instructions can leave an approved edit only in the archived delta, so the canonical spec may miss it.
- Pending decision from the user: Select the boundary and approved retry behavior for this partial state.
