Address review round $INPUTS.review_round in $INPUTS.change_dir. Read the previous page’s saved answer at $INPUTS.answers_file. If the pass mode is refused, the merge was refused and there is no feedback to apply. Preserve any prior work if the round is resumed.

Each answer names the chosen option by ID, label and detail. The detail says what that option asked this round to do. Address every option chosen, its note, each screenshot and command evidence comment and any plain-text note. Record an array in $ARTIFACTS_DIR/review-response-round-<answered round>.json with one entry per answer, note, screenshot comment and command evidence comment. Use a source code from the item as the item field, or use the screenshot path, command evidence ref, or note for standalone comments and plain text. Give each entry a one-line note, the commit when one was made, and one of these statuses. The person reviewing reads the notes at the top of the next page, so write them in plain words without decision or dispute codes, and in the past tense as what you did, such as “Kept …” or “Fixed …”:

- `fixed` when you completed the requested work.
- `declined` when work remains, including when the reviewer chose to handle it personally.
- `no-change` when the answer closes the item and it needs no further attention.
- `settled` when the reviewer resolved a dispute, including by dropping it or choosing a follow-up.
- `spec-change` when approved behavior needs to change and the reviewer has yet to decide the resulting dispute.

The workflow files a GitHub issue for each follow-up answer and records its link as the answer's issue. Name that issue in the note and in the entry's Settled line. A follow-up answer without an issue could not be filed; say so in the note.

A Run a review round answer asks nothing of you here: this round's code review covers that commit after you finish. Record it as `no-change` with a note saying the commit went to this round's review.

Keep failed checklist rows visible until verified. Choosing to leave a failure for the reviewer does not close the row. Report yourself blocked if the remaining work cannot proceed.

Decline requests that would alter approved behavior. In the change folder’s dispute log, append a numbered DISPUTE entry headed after the last entry, with a marker line of Status: spec-change, the request and approved requirement, and a Spec edit: line with the exact targeted edit when feasible. Leave the edit out for a new capability or a large revision. Record the dispute code in the note.

Apply a targeted spec edit only when the reviewer selected its spec-edit option. Change the spec and code together, editing the active delta if $INPUTS.archive_needed is true and openspec/specs/ otherwise. Record the approved edit and mark the dispute Settled in review round <n> in the change folder’s dispute log. A follow-up or drop option settles it without a code change. Put material choices in the decision log in that folder, with sequential DECIDE codes. Commit changes and log entries. When feedback changes what the change does, update $ARTIFACTS_DIR/pr-body.md with a change summary without test results.

For each response entry, add requestedFindings as an array of the IDs of previously logged review findings that the reviewer explicitly asks you to fix. Interpret the chosen option, Other text, notes, and CLI or UI prose together. Resolve references through that item and the decision and dispute logs. Leave the array empty if no fix was requested.

Mark a decision entry that only records the reviewer’s answer with `Settled in review round <n>` using the answered round. Commit your changes and leave the push to the workflow.
