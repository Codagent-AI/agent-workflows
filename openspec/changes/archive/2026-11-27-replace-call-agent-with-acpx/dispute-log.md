## DISPUTE-1: Audit finding 9 — private design documents are outside the revised implementation scope

Finding as given:

> 9. **`new`.** Definition: proposal, "Impact", Docs ("the design docs for the plugin and the overview").
>    - **Wrong:** I found no sign these were updated. The commit updates the READMEs, `AGENTS.md` and PROVENANCE. No checklist row, completion record or implementor decision mentions the two design docs.
>    - **Where:** I didn't find them among the tracked files, or by searching git history for added files named like design or overview docs outside `openspec/changes`. They may be kept outside this repository, which I couldn't check.

Requirement: The current proposal's Impact section requires updates to the repository README, the plugin's `AGENTS.md`, and PROVENANCE. It explicitly assigns the two private Claude pages to work outside this implementation.

Disposition: The finding described the proposal at audit time. Paul's commit `a7a892e` changed that scope. Leaving the private pages for the separate update is consistent with the current definition. See `evidence/design-artifact-scope.log` for the proposal diff and `evidence/resolve-findings-openspec.log` for validation of the revised change.

Settled in review round 1. Dropped the finding and kept the two private design pages separate from the implementation.

## DISPUTE-2: PR comment: Reuse of an acpx version probe after replacement

Status: spec-change

- Comment: `human-workflows/openspec/plugin/server.mjs:44320`, coderabbitai.
- Request: Re-probe on each admission or invalidate the cache when PATH or the executable changes.
- Rationale: The approved Refusals design and INTEG-6 deliberately cache a successful probe for the lifetime of the server. Invalidating that result requires a revised cache and version-admission policy.

Settled in review round 2. Dropped the request. Kept the successful acpx version check for the lifetime of the server.

## DISPUTE-3: PR comment: Cap the size of an individual ACP event

Status: spec-change

- Comment: `human-workflows/openspec/plugin/server.mjs:44777`, coderabbitai.
- Request: Fail a reviewer when an ACP record exceeds a fixed limit, keeping its raw log.
- Rationale: The approved reader handles valid events and caps the returned answer. A record-size rejection could fail an otherwise valid review because of a single tool event. The permitted event size and behavior on overflow need a design decision. The reported memory risk remains.

Settled in review round 2. Dropped the request. Very large ACP records can still put pressure on server memory.

## DISPUTE-4: PR comment: Preserve the first stop reason during cleanup

Status: spec-change

- Comment: `human-workflows/openspec/plugin/server.mjs:44940`, coderabbitai.
- Request: Keep an earlier cancellation reason even if the batch deadline fires during cleanup.
- Rationale: The approved outcome table checks the 60-minute time limit before cancellation. Giving cancellation precedence at that boundary would change the approved outcome ordering.

Settled in review round 2. Dropped the request. Kept timeout precedence when cancellation and the batch deadline both occur during cleanup.

## DISPUTE-5: PR comment: Include startup in the first poll deadline

Status: spec-change

- Comment: `human-workflows/openspec/plugin/server.mjs:45284`, coderabbitai.
- Request: Start the wait budget at admission and expose a pollable ID before the working-tree snapshot.
- Rationale: The wait requirement motivates this concern, but the approved flow performs refusal checks and the initial snapshot before launching reviewers and entering the result wait. Meeting a single admission deadline requires a public preparation state or a new startup-timeout outcome, including a rule for late refusals. Neither was approved.

Settled in review round 2. Dropped the request. Preparation can still add time before the first reply.

## DISPUTE-6: PR comment: Cancel after the last reviewer exits

Status: spec-change

- Comment: `human-workflows/openspec/plugin/server.mjs:45365`, coderabbitai.
- Request: Mark a settling batch canceled on a late request even when every reviewer has already finished.
- Rationale: The before-PR review specifically confirmed the fix that derives status from completed outcomes when cancellation stops no reviewer. Reversing it would conflict with the accepted behavior for the final tree check.

Settled in review round 2. Dropped the request. Kept the final status based on reviewer outcomes when cancellation stops no reviewer.

## DISPUTE-7: PR comment: Poll and cancel a batch during preparation

Status: spec-change

- Comment: `human-workflows/openspec/server/src/crosscheck.ts:108`, coderabbitai.
- Request: Register the startup ID as pollable and let cancel abort preparation.
- Rationale: The approved flow exposes a busy identifier while it checks prerequisites, then uses the result tools for a launched batch. Allowing cancellation and polling before admission completes adds an observable lifecycle and requires defining preparation failures and how they are delivered.

Settled in review round 2. Dropped the request. Kept polling and cancellation available after the reviewers start.

## DISPUTE-8: PR comment: Track process groups after the parent has exited

Status: spec-change

- Comment: `human-workflows/openspec/server/src/reviewer.ts:128`, coderabbitai.
- Request: Guarantee cleanup of detached descendants created after SIGTERM even if the leader exits before the next capture.
- Rationale: The approved macOS/Linux procedure captures descendants before SIGTERM and rescans while acpx is alive. A late detached process can be reparented before either snapshot sees it. Captured groups can still be killed, while reliably identifying unobserved reparented processes would require a different supervision design.

Settled in review round 2. Recorded a follow-up for tracking reviewer descendants created during shutdown. Cover a detached child in a new group that is created after SIGTERM and reparented before the next process snapshot. Verify cleanup without targeting unrelated process groups. This pull request keeps the existing snapshot-based cleanup and can still miss that descendant.

## DISPUTE-9: PR comment: Encode prompts as ACP text blocks

Status: spec-change

- Comment: `human-workflows/openspec/plugin/server.mjs:44172`, coderabbitai.
- Request: Encode stdin as a single text block so acpx cannot interpret bracket-prefixed input as content blocks.
- Rationale: The approved INTEG-1 contract explicitly requires acpx stdin to equal the lead prompt byte for byte. The installed acpx parser trims raw input and detects structured prompts. A text-block encoding preserves reviewer text but changes the approved transport and its regression assertion.
Spec edit: In INTEG-1, replace “each stdin equals the lead’s prompt byte for byte” with “each stdin decodes as one ACP text block whose text equals the lead’s prompt byte for byte”; preserve the assertion that no argument contains it.

## DISPUTE-10: PR comment: Verify post-SIGKILL exit and report surviving groups in results

Status: spec-change

- Comment: `human-workflows/openspec/plugin/server.mjs:44972`, coderabbitai.
- Request: Poll captured groups for a bounded interval after SIGKILL and report surviving groups in the tool result.
- Rationale: The approved shutdown design bounds escalation and the reviewer explicitly kept cleanup diagnostics on server stderr in DECIDE-13. The requested result warning and additional shutdown wait need approval. Signal-zero probes can also see exited zombies, which the reviewer approved treating as stopped.

## DISPUTE-11: PR comment: Preserve and escape non-UTF-8 Git filenames

Status: spec-change

- Comment: `human-workflows/openspec/plugin/server.mjs:45191`, coderabbitai.
- Request: Use raw path bytes for identification and lookups and define escaped paths in changed_paths.
- Rationale: The fix prevents a misleading unchanged result by returning the approved unknown result when Git paths cannot be represented losslessly. Full byte-path support still needs an escaping convention that avoids collisions and tells clients how to recover original bytes, including for Git commands that take a submodule working directory.

## DISPUTE-12: PR comment: Observe adapter-confirmed effort application

Status: spec-change

- Comment: `human-workflows/openspec/plugin/server.mjs:45254`, coderabbitai.
- Request: Make the result and state reflect whether the reviewer adapter accepted and applied requested effort.
- Rationale: Both fields now show effort as unapplied after a confirmed launch failure. The approved design defines supported effort keys and surfaces adapter errors. Proving application for every adapter and distinguishing unknown from denied needs an acknowledgement policy and a result contract.

## DISPUTE-13: PR comment: Use the session folder for standalone reviews inside Git

Status: spec-change

- Comment: `human-workflows/openspec/plugin/server.mjs:45334`, coderabbitai.
- Request: Launch unnamed reviewers in the caller’s subdirectory while keeping Git-root snapshots.
- Rationale: The approved Launching a reviewer design explicitly uses the repository root for Git checkouts, including unnamed calls. The new working directory would also change acpx configuration discovery and the review scope.
Spec edit: In Launching a reviewer, replace the Folder rule with a rule that unnamed reviews use the caller’s resolved session folder, named reviews use the Git root, and Git snapshots use the Git root in either case.

## DISPUTE-14: PR comment: Fingerprint content inside already-dirty submodules

Status: follow-up

- Comment: `human-workflows/openspec/server/src/worktree.ts:65`, coderabbitai.
- Request: Include nested worktree and index contents in the fingerprint instead of comparing nested HEAD alone.
- Rationale: The reviewer already selected a separate follow-up for this exact gap under DECIDE-12. Keeping the current submodule HEAD comparison honors that choice.

Settled in review round 2. The previously approved submodule follow-up covers this repeated finding.
