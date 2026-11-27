## Why

The first page from `improve-review-page`, in its own implementation run, still did not let a person decide from the page alone:

- **Items could not be understood without asking an agent.**
  - They used terms from the decision and dispute logs, such as "run diagnostics", "named test", "checker floor" and "ranking agent".
  - They retold what the agents did ("the tester wanted", "the agent kept"), mixed in bugs that were already fixed, and did not say what the reviewer would see or lose.
  - The ranking prompt already says to write for the person reviewing. Nothing checks it: `improve-review-page` left a check on the wording of items out of scope.
- **Key evidence missed the point.** It showed a test image at full size and a phone close-up of one header, while screenshots of the live review page went unpicked. Nothing says what key evidence should show.
- **Screenshots could not be read.** The live trial pages were captured 500 pixels wide and 8,600 tall. The viewer fits them to its height, so they shrink to slivers, and "Open full size" shows them at 500 pixels with no way to enlarge them.
- **Behaviors never tried live disappeared (a regression).** `improve-review-page` tells the ranker to leave out behaviors that passed with evidence, and a passing automated test counts. Before it, the page listed behaviors that only automated tests had checked as Low concerns. Now the page does not say which behaviors acceptance never tried.
- **Send feedback could not be clicked.** It stays disabled until every High and Medium question has an answer, and the only hint is a line of status text, so a reviewer cannot tell what is missing.
- **Some feedback had nowhere to go.** The summary and the change-size table have no comment box, and the table's rows are in no useful order.

The person reviewing should be able to read each item, understand what is being asked and what each answer does, and decide, without asking an agent to explain.

## What Changes

1. **A reader check on every page.**
   - After the ranking passes its check, a fresh agent sees only what the reviewer sees: the page's items and the change's proposal. It sees no logs, code or run files.
   - For each item, it says what the question asks, what each option would do, and what happens if the choice is wrong. It lists any term or claim it cannot understand from the page and the proposal alone.
   - Items it flags go back to the ranker for one rewrite. The page then publishes.
   - A reader check that fails outright does not stop the page.
2. **The ranking prompt says who the reader is.**
   - The reader has read the proposal, knows the product and knows how this workflow builds a change. They have not read the logs, the code or the run's files, and they were not there while the agents worked.
   - Each option says what the next round does with it. No option says it merges, since only the Merge button does.
   - Agents are named by their role, such as "the code review agent", and "you" means only the person reviewing.
   - The prompt gains one before-and-after example of an item.
3. **Key evidence shows the change working as a person would see it**, such as full views of the product in a live or real run, over test images and close-ups of one detail.
4. **Screenshots can be read.**
   - The viewer opens a screenshot fitted to its width, and Fit returns to that width. A screenshot taller than the viewer scrolls.
   - It zooms in and out with buttons, ctrl+scroll and a trackpad pinch.
   - On the page, a tall screenshot's preview shows its top at full width instead of the whole page as a sliver.
   - The acceptance tester captures screenshots at twice the pixel density.
5. **A comment on the summary.** The summary gets a comment box for anything without its own, such as the change-size table. It reaches the implementor as a note.
6. **The change-size table is sorted** by lines added, largest first, with Total last.
7. **Behaviors never tried live are back on the page.** A behavior that only automated tests checked, and that acceptance never tried, appears as a Low concern, one concern per feature.
8. **Send feedback can always be clicked.** With questions unanswered, a click marks each one, names their concerns with links to them, and scrolls to the first.
9. **Yellow means accept as is.** An item is Low only when the agent recommends accepting it with no further work. A Low item that would recommend a fix, a retest, a review round or any other work becomes Medium instead. High and Medium items can still recommend accepting as is. The ranker is told so, and the run moves a Low item whose recommended option is a fix, retest, review round or spec edit up to Medium.
10. **Unreviewed commits can get a review round.** Every Late commit item offers "Run a review round". Choosing it makes the next round's code review cover that commit: the reviewer reviews it, the implementor fixes what it finds, and the reviewer checks the fixes. The run adds the option when the ranking leaves it out. The commit stays on the page until that review has read it. A run with code review off does not offer it: its Late commit items offer keeping the commit or leaving it to the person reviewing.
11. **The next round sees what an option promised.** The page saves the chosen option's label and wording with its ID. Before, the round saw only the ID, such as "try", because the page's concern list is deleted when a round starts.
12. **The top of the page reads in order.** The section is called Description, since it holds the pull request's description. What the last round did with the feedback sits under its own "Since round <n>" subheading, each entry in the past tense.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `review-handoff`: the reader check and one rewrite; what key evidence shows; behaviors never tried live are Low concerns; Low only for items to accept as is; a review round on every late commit.
- `review-page`: the screenshot viewer's fit and zoom; the summary comment; the change-size table's order; Send feedback's check for unanswered questions; the Description section's name.
- `acceptance-rounds`: screenshots at twice the pixel density.
- `review-response`: the summary comment is answered as a note; each answer carries its option's wording; the "Since round <n>" list in the past tense; a review round on the chosen late commits.

## Technical Approach

- **Reader check.**
  - Three script steps and two agent nodes run after `check-ranking`, `recheck-ranking` or `place-ranking`: `prepare-reader` writes the items' own words as the page shows them, without their level, kind, source codes, link targets or Other box; `read-review`, a reviewer agent in a fresh context, reads them with the change's proposal; `flag-items` flags an item with any unclear term or an empty answer.
  - When some are flagged, `rewrite-items` resumes the ranking session with the reader's notes and returns new wording for those items only. `apply-rewrite` replaces their titles, details, prompts, option labels and link labels, keeping every source, link target, tier and option ID, and checks the result like any ranking, as leniently as the ranking it rewrites. If the check fails, each item keeps its rewrite only if the ranking still passes with it. A spec edit's wording is never rewritten.
  - The script steps never fail their node. An agent node that fails stops the round like any other agent failure.
  - A trial on `improve-review-page`'s first page flagged every item before and after the rewrite, but the rewrite cut the unclear terms from 6 to 11 per item down to 2 to 7. The reader is stricter than a person, so the rewrite count stays at one.
- **Prompts.** `rank-review` gains the reader and the example, the key evidence criterion, and a Low concern for each group of behaviors that only automated tests checked. It tells them apart by the checklist's Evidence column and the acceptance records it already reads. `read-review` and `rewrite-items` are new. `address-feedback` writes its notes for the next page's summary in plain words and the past tense, without codes. `acceptance-test` captures at twice the pixel density.
- **Questions.** After the ranking check, and after placement, `settleQuestions` adds "Run a review round" to any Late commit item without it, or removes it when code review is off, and moves Low items whose first option, the recommendation, is `fix`, `retest`, `review-round` or `spec-edit` to Medium. Other work options, such as one the ranker names "try", rely on the prompt.
- **Review round.** `prepare-review` in a feedback round reads the saved answers. For each `review-round` answer it finds the item on the answered page, takes its commits, and starts the review at the first parent of the earliest one when that is older than the reviewed head. The existing feedback review, fix and re-review then cover it. `address-feedback` records the answer as `no-change`. That response alone does not close the commit: `record-review` marks the commits in its range as reviewed once the feedback review has a result, and only then do they leave the Late commit items.
- **Page.** `review-page.js` and `.css` change the viewer, the size table and Send feedback, add the summary comment, and rename the Summary section to Description with a "Since round <n>" subheading over the recap. `collectReview` sends the summary comment as an answer entry for the item `note`, which the response check already accepts, and adds each chosen option's `label` and `detail` to its answer.

## Out of Scope

- How the decision and dispute logs are written.
- A Retest option for each scenario.
- A warning when the log commit fails. It is a question on the current page.
- A check on how many agent calls a page may spend.

## Impact

- **Cost.** One more agent call per page, and a second when items are rewritten.
- **Pack code and prompts.** `implement-change.yaml`, `finish-run.ts`, a new `review-reader.ts`, `review-send.ts`, `review-page.js` and `.css`, the prompts above, and their fixtures and tests.
- **Order.** It builds on `improve-review-page` and starts after that merges.
- **Eval harness.** No artifact the judges read changes.
