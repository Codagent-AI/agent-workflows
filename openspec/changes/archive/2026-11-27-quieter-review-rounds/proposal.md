## Why

This change is for the Archon pack in `factory-workflows/archon/`.

The second review page of a real change, "feat: run OpenSpec crosschecks through acpx", read as a run that had done much and found much worse. It had done two live checks and one fix, and it showed 8 High concerns where round 1 had shown 1:

- **Round 1's page came out before CodeRabbit reviewed.** CodeRabbit skips draft pull requests, so it starts once the run marks the pull request ready, and it registered its check 26 seconds after finalize's CI wait had already settled on green checks. Its 10 comments reached the run only in round 2. There, the finalize step fixed 3 and logged 7 as disputes needing a spec change.
- **Every spec-change dispute is red.** Six of the 8 High items were those declined comments, mostly narrow edge cases. Red should mean the gap should block the merge.
- **An answered item came back.** In round 1 the reviewer chose "Leave it for me to handle" for an evidence failure. Round 2 showed it again as High, though nothing about it had changed. Failures and failed checklist rows stay on every page whatever the answer.
- **"Since round 1" listed what didn't happen.** It had one entry per round 1 answer, 15 of 20 of them "Kept ..." notes, each linked to the commit that recorded the decisions. It left out the finalize step's fix.
- **The follow-up option promised what nothing does.** "Define a follow-up change" only marked the dispute settled in the dispute log, the same as "Drop the request".
- **Every round left a commit for the person to review.** Finalize's fixer commits its fixes for CI and pull request comments after the round's code review, and nothing reviews them. Round 3's page asked again about such a fix, after round 3 had reviewed round 2's.

Round 3's page showed four more problems:

- **"Since round 2" left out the round's code review.** It found a gap in how edits inside a changed submodule are detected and logged it as a decision, and the list named only commits.
- **A spec-edit option quoted the edit.** One dispute's option read as the replacement test rule, word for word. The reader rewrite keeps a spec edit's wording on purpose.
- **Log entries from review findings said the problem three times,** under Question, What breaks if wrong and Rationale.
- **An answered gap came back red.** The submodule gap was a new finding on the gap the reviewer had sent to a follow-up in round 2, and the page showed it as a fresh red item.

## What Changes

1. **Finalize waits for late checks.** Each finalize CI wait lasts at least three minutes, so a check that registers late, such as CodeRabbit's, is waited for before the round goes on.
2. **Spec-change disputes are ranked by what is at stake.** They are at least orange, since they need an answer, and red only when the gap should block the merge.
3. **An answered item stays off later pages until it changes.** An item whose answer asked for no work (keep, leave, drop or follow-up, with no note or Other text) is left off later pages, including failed steps and failed checklist rows. It returns when its text changes, or, for a failed step, the problems behind it.
4. **"Since round N" lists only what happened.** It lists the answers that got work done, the follow-up issues filed, the round's other commits, the base merge and the retest. Answers that needed nothing done are left out.
5. **Follow-up files an issue.** The option reads "File a follow-up issue". When the next round starts, the workflow files one GitHub issue per follow-up answer, with the item's title, its text and its log entry. The issue's link goes on the answer, in the entry's Settled line and in "Since round N". An issue that can't be filed is a red Failure item, and a resumed round files only the missing ones.
6. **Finalize's fixes are reviewed in their cycle.** With code review on, a fresh reviewer reviews each CI cycle's fix, with one fix round, before it is pushed. The fix it reviewed is not a Late commit item.
7. **"Since round N" says what code review found.** It names each finding the round's code reviews made and what became of it: fixed, on this page, or left as minor. A review that found nothing says so.
8. **Spec-edit options are plain.** The option says in plain words what the edit would change. The next round applies the edit the dispute log records.
9. **A log entry from a review finding states its problem once,** under What breaks if wrong.
10. **A repeat of an answered item shows the earlier answer.** The ranker may match a decision or dispute to an earlier item answered with no work. The matched item is yellow and shows "You answered this in round N" with that answer and any issue filed for it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pull-request-finalization`: each finalize CI wait lasts at least three minutes, and each cycle's fix is reviewed before its push.
- `review-handoff`: spec-change disputes are at least orange, and red only when the gap should block the merge, and the ranking check agrees. A follow-up issue that can't be filed is a failed step. A log entry from a review finding states its problem once, a repeat of an answered item is yellow with the earlier answer, and spec-edit options are not quoted.
- `review-response`: "Since round N" lists only what happened, including what code review found, answered items stay off until they change, follow-up files an issue, and the spec-edit option is described in plain words.
- `draft-pull-request`: with the wait on, the forge check also asks for `workitem.create`.
- `change-review`: finalize's CI fixes are reviewed in their cycle, with a result of their own.

## Technical Approach

- **Settle time.** `WaitOptions.settleSeconds` in `ci.ts` keeps the wait polling until that long after it started. `waitFinalize` sets 180 seconds. The acceptance waits, on a draft, keep none.
- **Tiers.** `logTier` in `review-inventory.ts` makes a spec-change dispute orange, and `rank-review.md` raises it to red only when the gap should block the merge.
- **Answered items.** `prepare-ranking` saves `review/prints-round-<n>.json`, each source's item text plus its step problems. `restingSources` reads each page's saved answers and drops a source whose latest answer asked no work and whose print hasn't changed. `inventory` and the publisher's step failures both leave those sources out.
- **Recap.** `recap` in `publish-review.ts` keeps `fixed` responses, adds the filed issues from the saved answers, then the branch's commits since the last page's head that no fixed response names, then the merge, retest and refusal notes.
- **CI fix review.** `ci-cycle-status` outputs the head CI ran on. In each CI cycle, after `fix-pr`, the review nodes of a feedback round run again with the place and mode `finalize`, from that head, before `push-ci-fix`. `record-review` and `end-review-round` add the commits a finalize review covered to `review/reviewed-commits.json`, which keeps them off the Late commit item.
- **Review recap.** `recordReviewed` marks a cycle `reviewed` when its reviewer ran, and `reopenRequested` marks a finding the person asked to fix `reopened`. `roundReview` in `review.ts` lists the findings of the round's feedback and finalize cycles, leaving out reopened ones, and `recap` adds them.
- **Spec edits.** `disputeQuestion` gives the spec-edit option a plain detail, `matchesDisputeChoices` compares option IDs only, and `applyRewrite` no longer keeps the edit's detail. The answer names the dispute, and `address-feedback` applies that entry's `Spec edit:` line.
- **Log entries.** `handoffSection` asks the question with the finding's location, puts the problem under What breaks if wrong, and the suggested fix and history under Rationale.
- **Repeats.** `prepare-ranking` writes `review/answered.json`, from `answeredItems`: each source whose latest answer asked no work, with its round, answer and issue. The ranking schema gains `repeats`. `isRepeat` accepts it only on a decision or dispute naming a listed source, the ranking check then requires the item only at yellow, and `settleRepeats` moves it to yellow with the earlier answer, which the page and the reader text show.
- **Follow-up.** `startRound` files the issues through the forge's `workitem.create`, with a marker line naming the pull request and the source, so a resumed round finds an issue it filed. It saves each link on the answer's choice. `settleQuestions` and the reader rewrite keep the follow-up option's wording the workflow's own. The `address-feedback` prompt names the issue in the note and the Settled line.

## Out of Scope

- Labels or project fields on the filed issues.
- Excluding the generated bundle `human-workflows/openspec/plugin/server.mjs` from CodeRabbit's review.

## Impact

- **Pack code and prompts.** `ci.ts`, `finalize.ts`, `forge.ts`, `finish-run.ts`, `publish-review.ts`, `review.ts`, `review-files.ts`, `review-inventory.ts`, `review-package.ts`, `review-pages.ts`, `review-questions.ts`, `review-reader.ts`, `review-repeats.ts` (new), `review-revisions.ts`, `review-round.ts`, `review-send.ts`, the review page's script and style, the review scripts, `implement-change.yaml`, the `address-feedback`, `rank-review` and `review-change` prompts, the fixtures and the tests.
- **Forge.** A run with the wait on needs a forge plugin that offers `workitem.create`. Archon's GitHub plugin does.
- **Time and cost.** Each finalize CI cycle lasts at least three minutes. Each cycle with a fix adds a reviewer session, and with findings an implementor turn and a re-review.
- **Workflow.** Eight nodes in the CI cycle loop, a `head` field on `ci-cycle-status`, which every fixture's stub now carries, and a required `repeats` field on each ranked item.
- **Eval harness.** Evals run with the wait off past acceptance, so they file no issues and their forge check is unchanged. No artifact the judges read changes.
