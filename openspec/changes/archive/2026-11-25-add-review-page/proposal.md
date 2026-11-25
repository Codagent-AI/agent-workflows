## Why

The pack's review package is a long Markdown block in the pull request description. The reviewer reads it on GitHub, then tells the factory what to do somewhere else, in a session or in pull request comments. Nothing carries the reviewer's decisions back to the run. The acceptance tester's screenshots, the strongest evidence that the change works, stay in the run's artifacts folder, named only by path. Codes such as `I3`, `D-04` and `AT-2` appear on their own, and the reviewer has to look each one up.

Archon now serves a run's HTML artifacts as sandboxed pages, with the images saved beside them. So the package can become a page the reviewer works in: they read the summary and see the screenshots first, answer a question under each item that needs their call, and then either send the answers back to the run or merge.

This change is for the Archon pack in `factory-workflows/archon/`, with small changes to the define plugin in `human-workflows/openspec/` and the `codagent-archon` plugin in `human-workflows/archon/`.

## What Changes

- **Review page.** When a run publishes its package, the pack also writes the round's page, `review-page-round-<n>.html`, to the run's artifacts folder for Archon to serve, and keeps `review-page.html` as the latest page. It shows its round, and opens on the change summary with a cloc count of the change's code lines by language, then key evidence: up to five acceptance screenshots the ranking agent picks, each with a title and a line on what it shows, then every screenshot as a thumbnail grouped by acceptance round. Then come the red items, the other items, and the decision and dispute logs. A run with no screenshots has no key evidence section. A contents sidebar links to each item. The page is read-only. Its look comes from a reference mockup kept in this change's folder, `mockup/review-page.html`, which has sample content and placeholder screenshots.
- **Questions.** The ranking agent ends each red, orange and yellow item with one or more questions: two to four options, the first one recommended, then "Other" for a free-text answer. Yellow items have the recommended option preselected. Every red and orange question must be answered before feedback can be sent. Every question takes an optional note, and the reviewer can comment on any screenshot.
- **Two buttons.** "Send feedback" sends every answer and screenshot comment to the run. "Merge" merges the pull request. When red or orange items remain, Merge first warns that the answers on the page will not be sent. Merge shows only when the archive and finalize passed, because the package is also published when the archive, a check, a review or a conflict blocks the merge. The run's state line no longer says red items block the merge: it names the failures that hide Merge, and says red items need the reviewer's call.
- **The run waits for the reviewer.** After publishing, `codagent-implement-change` pauses at a wait the page answers. When an answer arrives, the run saves it as a file and records it in the page it came from, so reopening an earlier page shows what was chosen there, read-only. Each feedback round first merges in the latest tip of the base branch and resolves any conflicts. Decisions the merge needs are logged and ranked like any other, and a conflict it cannot resolve becomes a red item. Then an implementor step addresses each answer. The run then goes through code review, push, finalize, ranking and publish again, writes a new review page for the round, and waits again. When the archive had not passed, the round also runs the existing archive steps again before finalize, and their repair gets the reviewer's answer. Each round records finalize's results afresh, so a failure the round fixed leaves the next page. A dispute the reviewer settled leaves the next page and stays in the dispute log. There is no limit on review rounds, because each one starts only when the reviewer sends feedback. Merge merges the pull request at the head the page shows, and the run ends. When the forge refuses the merge, because the branch moved or no longer merges cleanly, the run runs a round with no feedback and writes a new page that says why. A failure a round step reports goes on the next page; an agent that fails outright fails the run, and resuming the run continues the round.
- **Fixes after feedback are not retested in a browser.** A feedback round's fixes and conflict resolutions come after the accepted head, so the next page's orange Late commit item covers them. It also lists each acceptance journey they could affect, with its code, its title and the commit that touches it, with "Retest" as an option. The acceptance tester records the journeys it ran, so a later page can offer them. Choosing Retest makes the next round rerun those journeys in an acceptance round; when that round passes, the commits the page listed leave the item. An acceptance failure stays on each page until an acceptance round passes.
- **Feedback that needs a spec change is declined, then asked about.** The implementor does not make a change that would alter approved behavior. It logs a dispute, and the next page shows it as a red item with three options: a specific spec edit the page spells out, merging without it and defining a follow-up change, or dropping it. Choosing the edit makes the next round change the spec and the code together, in the change's delta before the archive passes and in `openspec/specs/` after it, and the page after that shows the spec change. The edit stays targeted: a request that needs a new capability or a large revision gets only the follow-up and drop options.
- **A new input turns the wait off.** The wait is on by default. Evaluation runs turn it off, so they end as they do today.
- **Codes say what they are.** A code is a word and an unpadded number: CHECK, DECIDE, JOURNEY, INTEG, E2E, HUMAN, ACCEPT, REVIEW, DISPUTE. They change wherever codes are written, read or checked: the pack's checklist, logs, review and acceptance prompts, the code that numbers review findings and keeps manual tests out of checklist evidence, and the define plugin's `test-plan` skill. The pack keeps accepting the old codes. On the page each code comes with a short title and links to its source.
- **Pull request description.** The package moves out of it. The description keeps the change summary and the run's state, and lists a link to every round's review page, adding each new round's link after the earlier ones, when the run knows Archon's address. The latest page also has one fixed address per run, and the `implement-change` skill finds it from a change name or a pull request.

## Capabilities

### New Capabilities
- `review-page`: the page the pack writes, its content order, its questions and screenshot comments, and its two buttons.
- `review-response`: the run's wait, merging in the base branch, how feedback is addressed, the retest option, feedback that needs a spec change, the merge, and finding the latest page.

### Modified Capabilities
- `review-handoff`: the ranking adds questions and picks the key screenshots; the publisher adds standard questions to the items it writes itself; log entries are numbered DECIDE-1 and DISPUTE-1; the state line stops saying red items block the merge; a checklist row whose named test CI ran is no longer red; the package is written as a page, and "Review first" leaves the pull request description.
- `pull-request-finalization`: "The run never merges the pull request" becomes: the run merges only when the reviewer chooses Merge on the page. Each review round records finalize's results afresh.
- `change-implementation`: checklist rows use the new codes.
- `change-review`: review findings use the new codes, and a feedback round may check again a logged finding the reviewer answered.
- `change-archive`: a feedback round runs the archive again when it had not passed, and the repair gets the reviewer's answer.
- `draft-pull-request`: the description holds the change summary, the run's state and a link to every round's page, not the package.
- `pack-settings-and-run-files`: the new input and the pages' files.

## Technical Approach

- The publisher in `.shared/lib/review-package.ts` renders each round's page, styled as the reference mockup, from the checked ranking, the logs and the screenshots in `acceptance-screenshots/`, escaping all agent text. No agent writes the page's HTML. Each round's page has its own file, so earlier pages stay as a record. It links screenshots by relative path, so the page works from Archon and as a file in a copied artifacts folder. It runs cloc on the branch against its base, leaving out lock files; without cloc the page says the count is unavailable.
- The ranking output gains `questions` on each item and a `keyEvidence` list. The ranking check rejects a red, orange or yellow item without a question, and a question without two to four options. The publisher gives a standard question to each item it writes itself: step failures, and the required items it places when the ranking still fails its check. A ranking that fails its check still produces a page.
- The wait is an Archon attention wait at the end of the workflow. The page reads its own run's current wait and answers it through Archon's existing `/api/workflows/runs/<runId>/answer` endpoint. The answer carries the action (feedback or merge), the page's round, the reviewed head, and the answers as JSON. The run refuses an answer from an earlier round's page, so a tab left open from round 1 cannot answer round 2. The Archon CLI or UI can answer the same wait when the page cannot.
- Archon fork prerequisite: today the page's policy blocks every API call. A fork change opens only its own run's attention and answer addresses, and merges before this change runs.
- Merge goes through the pack's forge layer as Archon's `pr.merge` operation, with the reviewed head as its condition, so a push after the page was written makes the merge fail. The pack adds `pr.merge` to the operations its forge check asks for.
- The review rounds are an Archon loop with no round limit of the pack's own. Archon lets each answered wait run one more pass past a loop's limit, so the loop's limit never stops a round the reviewer asked for. Fixtures cover each path.

## Out of Scope

- Merge queues.
- Sending answers when the run is not waiting, or starting a new run from the page.
- Sending answers with Archon's web login on: the page's requests carry no session cookie.
- Sending answers when Archon's `WEB_UI_ORIGIN` is set: Archon then accepts API calls only from that origin, and the page has no origin.
- Editing the package in place, or inline comments on its text.
- Changes to the tiers or the ranking rules, except one: when finalize passed CI, a checklist row whose named test a CI suite runs counts as verified.
- Spec changes beyond a targeted edit: a new capability or a large revision needs a follow-up change.
- Renaming codes in archived changes or in existing test plans.

## Impact

- `factory-workflows/archon/.archon/workflows/codagent/`: `implement-change.yaml` (the wait, the review loop, the merge), `.shared/lib/review-package.ts`, `review-inventory.ts`, `logs.ts`, `forge.ts`, `finalize.ts`, `evidence.ts`, `review.ts`, `rank-review.md` and the other prompts that write codes, new scripts, fixtures and tests.
- `factory-workflows/archon/AGENTS.md` ("Never merge" becomes "merge only on the reviewer's choice") and `README.md` (the run files table).
- `human-workflows/openspec/plugin/skills/test-plan/`: the codes it writes.
- `human-workflows/archon/`: the `implement-change` skill gives the person the page's address, waits with the run, and finds the latest page from a change name or a pull request.
- Archon fork: the page policy change, merged first.
- cloc becomes a tool the pack uses where the run works, including the evaluation machines; without it only the count is missing.
- Evaluation harness: it must turn the wait off, as its own pull request that works with both this branch and pack main. The harness also reads `AT-` codes from its fixture's test plan, so the pack keeps accepting test plans with the old codes and cites the codes the definition uses.
- Pull request readers on GitHub, including review bots, see only the summary and the link; the package itself is on the page.
- Risks: any HTML page in the run's artifacts could answer the run's wait, and so merge; the design must limit that, for example to the one page the publisher writes. A paused run keeps its worktree until it is answered, and whether a wait survives an Archon restart is untested. A spec edit from a feedback round lands after the archive, so the archived change no longer shows the final spec.
