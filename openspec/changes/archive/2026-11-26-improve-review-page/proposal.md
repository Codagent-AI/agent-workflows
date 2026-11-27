## Why

The first live trial of the review page, from `add-review-page`, showed that the page does not yet help a person decide what to do with a pull request:

- **Changes without a UI show no evidence.** The page's only evidence is acceptance screenshots. A CLI or pack change gets a full acceptance pass and then shows nothing of it, because the tester's command output stays in logs the page never shows.
- **Items cannot be read by a person.**
  - The red item for a failed acceptance is the step's raw check output: a markdown heading, temp folder paths, a stale `Local HEAD` and status strings.
  - The other items cite decision codes, source file paths and line numbers, and retell how the agent got there.
  - Titles name the agent's process instead of what is at stake, and questions ask about the process instead of the product.
  - When the ranking's repair fails, the items the script places itself show checklist codes and whole log entries.
- **The logs repeat the items and hide what they leave out.**
  - The page ends with the full decision log and dispute log as raw markdown. Most entries are already items above or were settled in an earlier round.
  - The ranking check never requires a decision, so in the trial's last round 12 of 13 decisions were in no item, and nothing showed which were settled and which were dropped.
  - Decisions the tester records in a retest never reach the committed log, and ordinary pull request comment disputes are not required either.
- **White items go nowhere.** The ranker files verified behaviors in a white tier that the page does not show.
- **An unpushed head still gets a page.** When a push fails, the run writes a page for a head GitHub does not have. That head cannot be reviewed there or merged, and its links do not work.
  - Every push today is one `git push`, and any failure goes to an agent.
  - A branch that moved on GitHub, for example after "Update branch", is rejected, and the agent's prompt treats that as a question for a person.

The person reviewing should see what was tested and what came out, in words they can act on, with every open judgment call in front of them and nothing else.

## What Changes

1. **Command evidence.**
   - The acceptance tester records, for each round, the commands it ran as evidence, next to its screenshots. Each entry has:
     - a title;
     - what it shows;
     - the revision;
     - the command;
     - a short verbatim excerpt of its output, up to 20 lines, chosen to show the behavior;
     - the full output, saved in the run's artifacts folder.
   - The publisher leaves out an entry whose saved output is missing or does not contain its excerpt, and reports it the way it reports a bad screenshot entry today.
   - The page's evidence shows each entry's title, what it shows, the command and the excerpt, with the screenshots, grouped by acceptance round. The excerpt shows as the command printed it. The full output stays in the run's folder and is not on the page.
   - Key evidence can pick screenshots or command evidence, at most five in all. A run with neither has no evidence sections.
2. **Items written for a person.**
   - Each item's title says what happened or what is at stake.
   - Its body uses plain words and short lists, in terms of what a user types or sees, and says in one short list what covers the behavior and what does not.
   - Item text holds no decision codes, source file paths, line numbers or agent history. A file name the product's user deals with, such as a config file, may appear.
   - Sources become labeled links at the end of the item, such as "How the agent decided".
   - Each question asks about the product's behavior, and each option says in one line what choosing it does.
   - **Failed steps.**
     - The publisher still guarantees a red item for each failed step, and adds to it one fixed line from the run's results saying what failed, such as "Acceptance did not converge after 3 rounds".
     - The ranker writes the rest from the tester's report and the run's results: why it failed, whose problem it is, what went untested and what covers it instead. Its options fit the cause, so a setup failure does not offer "Fix it in the next round".
     - When the ranker writes none, the publisher writes a short plain item. It never pastes raw output.
     - An item the ranker writes about the same cause becomes part of that red item, so the same failure is not shown twice.
   - A defect acceptance found says what the tester did, what it expected and what it saw, with an excerpt of the real output.
   - Items the script places itself, when the ranking's repair fails, are written plainly too.
3. **No file paths, and only GitHub links.**
   - Apart from verbatim excerpts, the page shows no file path references.
   - Every link goes to GitHub at the head the page shows: committed files and line ranges, the decision and dispute logs, and commits. An item for a failed step that shows only in run files has no links.
   - Run files that are not on GitHub, such as the tester's report, step results and review findings, are not on the page. An item says what matters from them in its own words.
4. **Every open decision and dispute is an item; white and the logs go.**
   - **What the check requires.**
     - An item for every open decision, at least yellow. This includes the decisions a retest tester records in the run's own log, which today never reach the committed log.
     - An item for every open dispute, pull request comments included, at least yellow, with the higher minimums that exist today.
     - A decision or dispute is open unless the reviewer settled it in an earlier round or it only records the reviewer's own answer. An answer to a question that a grouped item's decisions and disputes share settles all of them. A dispute with a question of its own is settled only by its own answer.
   - **How decisions are ranked.** The ranker ranks each decision by how bad it would be if it is wrong, whether or not it changes behavior. The orange rule names cost, security, performance, test strength and maintainability along with scope, guarantees, callers and reversibility.
   - **Tiers.** **BREAKING** for the ranking's output: the white tier and the Verification type are removed, leaving red, orange and yellow. What acceptance verified shows in the evidence sections.
   - **The logs.** The page drops the decision log and dispute log sections and links to both logs on GitHub.
5. **A failed push stops the run.**
   - Every push first fetches the branch and merges in commits GitHub has that the local branch lacks, never rebasing or forcing. A merge that conflicts is aborted and goes to the agent repair.
   - Network errors, timeouts and GitHub server errors are retried three times with backoff.
   - **Left to a person, with no agent spent on them.** Each is reported in plain words:
     - expired or invalid credentials, with the fix: log in again, then resume the run;
     - GitHub still unavailable after the retries;
     - GitHub refusing a change to `.github/workflows` because the token lacks the `workflow` scope.
   - Every other failure, such as a failing pre-push hook, a merge conflict or uncommitted changes, goes to the agent repair.
   - Agents in acceptance, finalize and feedback rounds commit and never push. The workflow's push pushes their commits.
   - **When the push still fails.** A push that still fails after its repair fails the run, in acceptance, finalize or a feedback round, and no page is written. Resuming the run retries the push.
     - In acceptance, the failed push ends the rounds, and the push after them fails the run. A resume then retries only that push, without running acceptance again, and the page says acceptance stopped because the push failed.
     - In a feedback round, a resume starts the round again from the saved feedback.
   - The publisher refuses to write a page for a head that is not the pull request's head on GitHub.
6. **The rail** shows inline code in item titles and wraps long titles.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `review-page`:
  - content order without the log sections;
  - command evidence with screenshots;
  - item layout with labeled links and no file paths;
  - GitHub-only links;
  - the rail;
  - a reference mockup kept with this change, `mockup/review-page.html`.
- `review-handoff`:
  - three tiers, with every open decision and dispute required;
  - the wider orange rule and settlement of grouped items;
  - failed-step items with the publisher's fixed line and the ranker's text, and plain fallback items;
  - key evidence that may pick command evidence;
  - no failed-push items;
  - no page for a head GitHub does not have.
  - the run's state line in the pull request description only.
- `acceptance-rounds`:
  - the tester records command evidence for each round;
  - the push fetches, merges, retries and reports;
  - a failed push fails the run.
- `pull-request-finalization`: finalize's push follows the same rule, so a push that still fails fails the run instead of going on to the page.
- `review-response`: a feedback round's push follows the same rule.
- `pack-settings-and-run-files`: a push is no longer among the failed steps that are recorded for the page and gone past, after the acceptance rounds or in a feedback round.
- `draft-pull-request`: the description's state line is the run's, since the page no longer has one.

## Technical Approach

- **Push.**
  - All of the pack's pushes go through `acceptancePush` in `pull-request.ts`. It gains the fetch and merge, the retries and a classification of the failure.
  - The repair nodes run only for the classes an agent can fix.
  - A push failure that survives its repair ends the run as failed. Report mode no longer continues to the page after a push failure.
  - Archon restarts a loop from its first pass when a node in it fails. So in the acceptance rounds a failed push ends the rounds, and the push after them is the node that fails.
  - The prompts that told agents to push now tell them to commit, and the node after each repair pushes.
  - The publisher compares its head with the pull request's head through the forge before writing.
- **Item shape.**
  - `link` becomes a list of labeled links. Each link names a target the publisher resolves: a committed path with a line range, a commit, or a log entry.
  - The publisher builds GitHub permalinks at the page's head from the forge's repository, so the ranker never writes URLs.
  - The check rejects a link whose target is not a committed file at the head or a commit in the pull request.
- **Failed steps.**
  - The ranker may write an item that cites `failure:<step>`. The check requires one red item for each failed step, as the inventory does today.
  - The publisher keeps the ranker's text when it is valid, adds the fixed line, and otherwise writes a plain fallback.
  - The standard question remains the fallback question only.
- **Inventory.**
  - Required decisions come from the committed log and from entries the run's own log gained after the first review round.
  - Every unsettled dispute-log entry is required.
  - Settlement reads the response records and applies an answer to every source of the item it answered.
  - The address-feedback step marks entries that record the reviewer's answer as settled when it writes them.
  - The tier list loses white, and the ranking schema, check and fallback follow. Fallback items get plain titles and bodies built from the entry's heading and a link to it.
- **Command evidence.**
  - Command evidence gets its own manifest for each round beside the screenshot manifest, read by the same media reader with the same problem reporting.
  - Key evidence picks name entries the reader found.
- **Page.**
  - The template and its script render the evidence entries, the labeled links and the rail fixes, and drop the log sections.
  - The reference mockup from `add-review-page`, copied to this change's folder as `mockup/review-page.html` and updated, shows the new layout with sample content and placeholder screenshots. The look-and-layout requirement points to it.
- **Prompts.** `rank-review`, `repair-ranking`, `acceptance-test`, `address-feedback`, `repair-push`, `repair-ci-wait` and `repair-acceptance-pr` change to match.

## Out of Scope

- The other page defects from the `add-review-page` acceptance pass:
  - the green dot on the "needs attention" line;
  - the duplicate Summary heading;
  - the recap citing the round's commit on every bullet;
  - the pull request description still saying "needs attention" after a merge;
  - the stray `---` code parsed from the checklist table.
- A check on the wording of items. The prompt and the item shape carry it.
- Showing full command output, or any other run file, on the page.
- Committing evidence files to the branch.
- The pull request description. It shows only the change summary, the state line and the list of pages, and does not change.

## Impact

- **Pack code and prompts.**
  - `.shared/lib`: `pull-request.ts`, `finish-run.ts`, `review-work.ts`, `review-inventory.ts`, `review-package.ts`, `review-questions.ts`, `review-media.ts`, `review-round.ts`, `review-send.ts`, `logs.ts`, `publish-review.ts`, `review-links.ts`, and `review-page.js`, `.css` and the template.
  - The ranking schema and the push repair conditions in `implement-change.yaml`.
  - The prompts named above.
  - Their fixtures and tests.
- **Ranking output.** `review-attention.json` loses `white`, and items carry `links` instead of `link`.
- **Run outcome.** A run whose push cannot be completed now fails instead of completing with a page.
- **Eval harness.**
  - Before the first eval rep, check whether the and-scene judges read the ranking, the package or a run's failure state. Any harness change goes in its own PR, working with both the branch and pack main.
  - The `review_wait=false` harness change that `add-review-page` already needs is separate.
- **Design doc.** The pack's design doc is updated for the new evidence, items, tiers and push.
