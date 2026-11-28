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

## DISPUTE-3: PR comment: Cap the size of an individual ACP event

Status: spec-change

- Comment: `human-workflows/openspec/plugin/server.mjs:44777`, coderabbitai.
- Request: Fail a reviewer when an ACP record exceeds a fixed limit, keeping its raw log.
- Rationale: The approved reader handles valid events and caps the returned answer. A record-size rejection could fail an otherwise valid review because of a single tool event. The permitted event size and behavior on overflow need a design decision. The reported memory risk remains.

## DISPUTE-4: PR comment: Preserve the first stop reason during cleanup

Status: spec-change

- Comment: `human-workflows/openspec/plugin/server.mjs:44940`, coderabbitai.
- Request: Keep an earlier cancellation reason even if the batch deadline fires during cleanup.
- Rationale: The approved outcome table checks the 60-minute time limit before cancellation. Giving cancellation precedence at that boundary would change the approved outcome ordering.

## DISPUTE-5: PR comment: Include startup in the first poll deadline

Status: spec-change

- Comment: `human-workflows/openspec/plugin/server.mjs:45284`, coderabbitai.
- Request: Start the wait budget at admission and expose a pollable ID before the working-tree snapshot.
- Rationale: The wait requirement motivates this concern, but the approved flow performs refusal checks and the initial snapshot before launching reviewers and entering the result wait. Meeting a single admission deadline requires a public preparation state or a new startup-timeout outcome, including a rule for late refusals. Neither was approved.

## DISPUTE-6: PR comment: Cancel after the last reviewer exits

Status: spec-change

- Comment: `human-workflows/openspec/plugin/server.mjs:45365`, coderabbitai.
- Request: Mark a settling batch canceled on a late request even when every reviewer has already finished.
- Rationale: The before-PR review specifically confirmed the fix that derives status from completed outcomes when cancellation stops no reviewer. Reversing it would conflict with the accepted behavior for the final tree check.

## DISPUTE-7: PR comment: Poll and cancel a batch during preparation

Status: spec-change

- Comment: `human-workflows/openspec/server/src/crosscheck.ts:108`, coderabbitai.
- Request: Register the startup ID as pollable and let cancel abort preparation.
- Rationale: The approved flow exposes a busy identifier while it checks prerequisites, then uses the result tools for a launched batch. Allowing cancellation and polling before admission completes adds an observable lifecycle and requires defining preparation failures and how they are delivered.

## DISPUTE-8: PR comment: Track process groups after the parent has exited

Status: spec-change

- Comment: `human-workflows/openspec/server/src/reviewer.ts:128`, coderabbitai.
- Request: Guarantee cleanup of detached descendants created after SIGTERM even if the leader exits before the next capture.
- Rationale: The approved macOS/Linux procedure captures descendants before SIGTERM and rescans while acpx is alive. A late detached process can be reparented before either snapshot sees it. Captured groups can still be killed, while reliably identifying unobserved reparented processes would require a different supervision design.
