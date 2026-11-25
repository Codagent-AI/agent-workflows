## Context

The pack's workflow, `factory-workflows/archon/.archon/workflows/codagent/implement-change/implement-change.yaml`, ends today with a straight tail after acceptance: `commit-logs`, the archive nodes, `finalize-push`, `mark-ready`, the `ci-cycles` loop, `final-ci`, `record-finalize`, the ranking nodes (`prepare-ranking`, `rank-review`, `check-ranking`, `repair-ranking`, `recheck-ranking`, `place-ranking`) and `publish-review-package`, which writes the package into the pull request description and returns the run's outcome. The code for that tail is in `factory-workflows/archon/.archon/workflows/codagent/.shared/lib/`: `finish-run.ts` dispatches each `op`, `review-inventory.ts` finds the required items, `review-package.ts` checks, places and renders the ranking, and `forge.ts` lists the forge operations the pack uses.

Archon facts this design relies on, read on the fork's `dev`:

- An attention wait (`wait: { attention, form: message }`) pauses the run with no time limit. Its answer is free text, read downstream as `$<wait-id>.output.text`. Each pause gets a random occurrence id. The run keeps its worktree while it waits.
- `GET /api/runs/<run>/attention` returns the pending wait with its `occurrence` and `message`. `POST /api/workflows/runs/<run>/answer` takes `{ occurrence, text }` and answers 409 when the occurrence is stale or the run is not waiting. An answered run continues under `archon serve`, or after `archon workflow wake`.
- The CLI and the UI answer the same wait: `archon workflow answer <run> --occurrence <id> --text <text>`.
- A `loop_group` body may end in a wait, which must be the body's only terminal node. Each answered wait lets the loop run one pass beyond `max_iterations`. Loops can nest. `$LOOP_PREV.<node>.output` reads the previous pass.
- Archon serves a run's HTML artifacts at `<archon>/api/artifacts/<run>/<path>` as sandboxed pages with an opaque origin, and serves PNG, JPEG, GIF and WebP images beside them, but not SVG.
- `archon forge` offers `pr.merge` with `{ ref, method, conditions: { head } }`. GitHub refuses the merge when the head differs.

## Goals / Non-Goals

**Goals:**
- One workflow run covers every review round, from the first page to the merge.
- Only the pages the run published can answer its wait.
- Every round reuses the existing archive, finalize, review and ranking nodes.
- The page is written by code from checked data. No agent writes its HTML.
- Evaluation runs keep today's behavior by turning the wait off.

**Non-Goals:**
- Compacting the implementor's session before the wait. First measure what a resumed round costs.
- Answering with Archon's web login on, or with `WEB_UI_ORIGIN` set.
- A merge queue, or starting a new run from the page.

## Approach

### Archon prerequisite

An attention wait gains `pages`, a list of artifact paths, literal or resolved at pause from upstream outputs. While the run is paused at that wait and it has no answer yet, Archon serves exactly those pages with one more policy clause: `connect-src <archon>/api/runs/<run>/attention <archon>/api/workflows/runs/<run>/answer`. Every other HTML artifact keeps a policy with no `connect-src`, so it cannot make any request. The list is stored with the wait, so it survives a restart. This change merges into the fork's `dev` before the pack change runs.

### Settings

`.pack/pack.yaml` gains two settings, passed to the included workflows like the others:

- `review_wait`, a boolean, default `true`. `validate-inputs` refuses any other value.
- `archon_url`, a string, default empty. It is only used for links in the description.

`check-forge` asks for `pr.merge` only when `review_wait` is true.

### The review loop

Every node after `list-unverified` and `recheck-unverified`, from `commit-logs` through `publish-review-package`, moves into one `loop_group`, `review-rounds`. It has `max_iterations: 1`, `on_exhausted: complete`, and an `until_bash` that succeeds only when `review/outcome.json` exists. Only a pass that ends the run writes that file, and such a pass skips the wait, so `until_bash` is false after every pass that waited. The loop runs only when `finish` is true, so a run with `stop_after: acceptance` skips it. Its body, in order:

1. `start-round` (script). It reads `$LOOP_PREV.wait-for-review.output.text` and the run files, and returns:
   - `round`, and `mode`: `first`, `feedback`, `refused`, `merged`, `closed` or `stale`, with a `reason`;
   - `change_folder`: the archive folder `archive/state.json` names when the archive passed, and otherwise the active change folder;
   - `archive_needed`: true on the first pass, or when the archive has not passed;
   - `retest`, and the chosen `journeys` as JSON, when the answers chose Retest;
   - `answers_file`: the saved answers the round works from.

   It is described below.
2. The round's own steps, which run only when `mode` is `feedback` or `refused`: `merge-base`, `resolve-merge`, `address-feedback`, `check-response`, the round review, `push-round` and the retest.
3. The existing tail, each node guarded by `mode` so it skips on `merged`, `closed` and `stale`: `commit-logs` (first pass only), the archive nodes (when `archive_needed` is true), `record-archive`, `finalize-push`, `mark-ready`, the nested `ci-cycles` loop, `final-ci`, `record-finalize` and the ranking nodes. `record-archive` also depends on `start-round`, so it runs on every pass the tail runs. When the archive nodes were skipped, it returns `start-round`'s `change_folder`. Every tail node reads the change folder from `record-archive`.
4. `publish-review-package`. It runs on every pass except `merged` and `closed` ones. On a `stale` pass it writes nothing. It returns the current round's message and page from `review/pages.json`, with `start-round`'s reason after the round prefix when there is one.
5. `wait-for-review`, the body's last node. It runs when `review_wait` is true and `mode` is not `merged` or `closed`, with `wait: { attention: $publish-review-package.output.message, form: message, pages: [$publish-review-package.output.page, review-page.html] }`.

Each node in the body uses `trigger_rule: none_failed_min_one_success`, so skipped nodes lead on to the wait. The first pass is the tail as it runs today, plus the wait. Each answer runs one more pass. The loop ends at the first pass whose wait is skipped: after a merge, after `start-round` finds the pull request closed, or on the first pass with the wait off.

A new `end-run` node after the loop, also fed by `end-after-acceptance`, gives the outcome. It becomes the workflow's `returns` node, keeping `outcome_field: succeeded`. It reads files, not loop outputs: `review/outcome.json` when the run merged or found the pull request closed, and otherwise `step-results.json` and the acceptance status, as `publish-review-package` does now. A merged run succeeds, and a run whose pull request was closed fails. With the wait off, the run succeeds only when acceptance converged and the archive and finalize passed. With `stop_after: acceptance`, it takes the outcome from acceptance alone.

### Recording an answer

`start-round` runs before anything else in a pass. It works out where the run is from the run files, not from the loop's previous output alone. Resuming a failed run restarts the loop at its first pass, and a bare resume answers the wait with empty text, so the previous output alone could make a later round look like the first. Given the current round `n`, from `review/pages.json`:

- **First pass:** `review/pages.json` does not exist. `mode` is `first`, and the round is 1.
- **Resumed round:** round `n`'s answers are saved and round `n + 1` has no page. This pass runs round `n + 1` again from the saved answers, with mode `feedback`. Every round step is safe to run again.
- **Empty answer:** with no saved answer for round `n`, `mode` is `stale` and nothing is written.
- **JSON answer:** it parses `{ action, round, head, answers, screenshotComments }`. When `round` is not `n`, `mode` is `stale` and nothing is written.
- **Plain text from the CLI or UI:** `merge`, trimmed and in any case, is a merge at the head page `n` shows. Any other text is feedback for round `n`, kept as one note.
- **Pull request state:** before acting on an answer, it reads the pull request. When the pull request was merged outside the run, it writes `review/outcome.json` with `merged` and returns `mode: merged`. When it was closed, it writes `closed` there and returns `mode: closed`.
- **Accepted answer:** it saves the answer as `review-answers-round-<n>.json`. It writes the answer into `review-page-round-<n>.html`, and into `review-page.html` while that page is still round `n`, as the `<script type="application/json" id="sent-answers">` block, with the time it was sent, escaped like the page's data block. It updates round `n`'s entry in `review/pages.json`.
- **Feedback:** `mode` is `feedback`, and the round becomes `n + 1`. It clears finalize's results (`finalize-results.json`, `ci/latest.json` and the finalize entry in `step-results.json`) and the round steps' entries in `step-results.json`, after copying them into `review/round-<n>/` the first time. The acceptance and archive entries stay until a step records them again.
- **Merge:**
  - When round `n`'s archive or finalize failed, it does not call the forge. It returns `mode: stale`, with the failure as the reason, so the run asks again.
  - Otherwise it calls `pr.merge` with `method: merge` and `conditions: { head }`.
  - Applied: it writes `review/outcome.json` with `merged`, rewrites the description so round `n`'s entry says it was merged, and returns `mode: merged`.
  - Refused because the head moved or the branch no longer merges cleanly: `mode: refused`, with the forge's reason, and the round becomes `n + 1`. That round runs with no feedback, and clears finalize's results as a feedback round does.
  - Refused or failed for the repository's rules, such as a required approval or a merge method the repository doesn't allow: `mode: stale`, with the forge's reason, and no round.
  - Verification failed, outcome unknown, or a run audit the forge could not save: it reads the pull request back. It acts as applied when the pull request was merged, and as a rules refusal otherwise.
  - A Merge chosen with no outcome, as after a failure, is checked against the pull request the same way.

### A feedback round

- **Merge in base.** `merge-base` fetches, then merges the tip of the pull request's current base, read from the forge, and the pull request branch's remote tip when it moved. It never rebases or force pushes. On a conflict it leaves the merge in progress, and `resolve-merge`, the implementor, resolves it. Each judgment call goes to the decision log. A conflict it cannot resolve without a person is aborted and recorded in `review/merge-conflicts.md`, which the inventory turns into a red item.
- **Address the feedback.** `address-feedback`, the implementor, reads the answers file and handles every answer, note and screenshot comment. It writes `review-response-round-<n>.json`: one entry per answer with `item`, `status` (`fixed`, `declined`, `no-change`, `settled` or `spec-change`), `commit` when it made one, and a one-line note.
  - An answer the specs rule out is declined. The implementor logs a dispute marked `spec-change` that holds a specific spec edit, or says the request needs a follow-up change.
  - A chosen spec edit changes the spec in the change's delta when the archive has not passed, and in `openspec/specs/` when it has, together with the code.
  - A settled dispute gets a `Settled in review round <n>` line in its dispute log entry.
  - When the round changes what the change does, the implementor also rewrites the change summary in `pr-body.md`.
- **Check the response.** `check-response`, a script, checks each entry: it must name a known item by one of its source codes, with a known status. It drops entries that fail and records them as a failure, which the next page shows as a red item.
- **Review.** The round's review covers the round's own commits since the head its page showed, and the conflict resolutions of its base merge. It does not cover the base branch's own commits. It is the acceptance round's review: a fresh reviewer, one fix turn and one re-review in the same reviewer session. Its result goes to `review/feedback.md`. `review_strategy: none` skips it.
- **Push.** `push-round` pushes without force, with one implementor repair.
- **Retest.** It runs only when the answers chose Retest on the Late commit item. A fresh tester reruns the chosen journeys as a new acceptance round, numbered after the last one, followed by the CI wait, the handoff and the gate. It reports and does not fix.
  - It never moves the accepted head. That head is saved in `review/accepted-head.txt` when the acceptance rounds end, and the inventory reads it from there.
  - When the gate is ready, it records the commits the page listed in `review/retested-commits.json`, and the inventory leaves those commits out of the later commits. Commits made in the same round stay.
  - When it is not ready, it records a `retest` failure in `step-results.json`, whatever acceptance's earlier result was. The next page has a red Failure item whose first option is "Fix it in the next round".
- **Then the tail.** The archive runs again when `archive_needed` is true, and its repair gets the answers file. A rerun is a fresh attempt. `archive-change` moves the earlier attempt's `archive/state.json`, `before.json` and `specs-before.json` into `archive/attempt-<k>/`, then captures a new baseline at the round's head. Archive paths the earlier attempt left uncommitted stay the archive's own. Finalize records its results afresh, with its own three CI cycles. Ranking and publishing run as in the first pass.
- **The description.** In a feedback round, `publish-review-package` updates the description before it writes the page. When the update fails, it records a `description` failure, which the page shows as a red item, and the wait still opens. A page that cannot be written still fails the run.

Every implementor step in a round continues the implementor's session, `context: { resume: session-report }`, like the acceptance fixes and finalize's fixes. The reviewer, the tester and the ranker start fresh sessions.

A failure a step reports in a round never fails the run. It is recorded in `step-results.json`, and the run goes on to publish and wait. That covers the base merge, a blocked `address-feedback`, a rejected response, the push, the archive, finalize, a blocked repair and the description update. An agent node that fails outright, from a provider error or output that never fits its schema, fails the run as it does today, because Archon opens no wait in a pass after a node failed. Resuming the run continues the round, as `start-round` describes above.

### Item identity and the next page

Every item carries its source codes in `source`: `CHECK-<n>`, `DECIDE-<n>`, `DISPUTE-<n>`, `HUMAN-<n>`, `failure:<step>`, a commit SHA for a late commit, or `merge-conflict`. An answer or a response names an item by one of its codes, and it applies to every item with that code. So an item keeps its identity when the ranker groups items differently in a later round.

The inventory reads every `review-response-round-<k>.json` in order, and for each source code the latest status wins. It drops a code from the required set when that status is `no-change` or `settled`, or when its dispute entry is marked settled. Late commits are dismissed one commit at a time, so later commits still show. `checkRanking` and `placeRanking` also reject an item with a dismissed code, so it cannot reappear. A fixed failure leaves because `start-round` clears finalize's results each round and the archive records its results afresh. A dispute the response marks `spec-change` is a required red item.

### The ranking

- **New fields.** `rank-review` returns `questions` on each red, orange and yellow item, and a `keyEvidence` list of up to five screenshots. Each question has two to four options, the first recommended. The Late commit item gains `journeys`: each with its code, its title and the commit that touches it. With journeys listed, its question offers Retest.
- **Checks.** `checkRanking` rejects:
  - a red, orange or yellow item with no question;
  - a question with fewer than two or more than four options;
  - a key screenshot that isn't in a manifest;
  - a journey code that no `acceptance-journeys/round-<k>.json` lists, unless an older test plan lists it as an `AT-` case;
  - a commit not among the later commits;
  - a spec-change dispute whose question lacks the follow-up and drop options, which have fixed option ids.
- **Standard questions.** `placeRanking`, and the publisher for step failures, give the items they write a standard question for their type. For a spec-change dispute, `placeRanking` builds the question from the dispute entry: the edit it records, merging with a follow-up change, or dropping it, or only the last two when it records no edit.
- **Later commits.** `laterCommits` lists the first-parent history after the accepted head, less the commits in `review/retested-commits.json`. A base merge is listed only when its conflict resolutions changed files, sized by `git show --remerge-diff`.
- **Prompt inputs.** The ranker gets the answers file and the response file of the round just run, so the page's summary can say what changed.
- **Types.** The item types become Risk (not verified), Failure (failed), Verification (passed), Agent decision, Dispute, Late commit and Human check. Step failures are recognized by their `failure:<step>` source, not by type, so the renderer no longer drops ranked Failure items.
- **CI rule.** When the finalize result passed with checks (`had_checks`) and a row that isn't verified cites a test file that exists at the head, `checklistItems` makes it a required yellow item instead of a required red one, so it stays on the page. The ranker decides whether a CI suite runs that test. If none does, it raises the row to red.
- **State line.** It names the archive or finalize failure that hides Merge, and says how many red items need the reviewer's call. It no longer says they block the merge.

### The page

- **Template.** `publish-review-package` renders `review-page-round-<n>.html` from one template built from `openspec/changes/add-review-page/mockup/review-page.html`, then copies it to `review-page.html`.
- **Data.** The template's script renders the page from one embedded JSON block, written with `<`, `>` and `&` escaped as `\u003c`, `\u003e` and `\u0026`. Agent text is placed with `textContent` only.
- **What the data holds.** The round, the head, the accepted head, the run id, the state line, whether Merge shows, whether the wait is on, the change summary, the round recap, the cloc table, the screenshots by round, the key evidence, the ranked items with questions, and both logs.
- **Links.** Links to screenshots and other artifacts are relative, so a copied artifacts folder works as files.
- **Size of the change.** cloc counts the branch against `git merge-base HEAD origin/<base>`, leaving out lock files. If cloc is missing or fails, the table says the count is unavailable.
- **Round recap.** From round 2 on, the top of the Summary section says what the round did with the feedback. It has one line per answer, note and screenshot comment, from `review-response-round-<n-1>.json`, each linked to the item or commit it produced. The publisher adds what it knows itself: the base merge, the retest result, and the reason a merge was refused.
- **Sending.**
  1. The page takes Archon's origin and the run id from its own address, `/api/artifacts/<run>/...`.
  2. It reads the attention address. When the pending message does not start with exactly `Review round <n>:`, it says the run is not waiting for this page and sends nothing. The colon keeps round 1 from matching round 12.
  3. Otherwise it posts `{ occurrence, text }`, with the answer as JSON text.
  4. A 409 is reported the same way. A network failure, or a page opened as a file, shows the answers as text with `archon workflow answer <run> --occurrence <id> --text '<answers>'`. The occurrence is filled in when the page read it. Otherwise the shown command first looks it up with `archon workflow get <run>`.
- **Send module.** The send logic is a small module in `.shared/lib/` that the publisher inlines into the page's script, so bun tests can run it without a browser.
- **Answered pages.** On load, a non-empty `sent-answers` block makes the page a read-only record: the chosen options, notes and comments, the action and the time, with no buttons. A page from a run with the wait off has no buttons.

### Screenshots and journeys

The tester saves each acceptance round's screenshots under `acceptance-screenshots/round-<k>/`, as PNG, JPEG, GIF or WebP. It writes a `manifest.json` there: one entry per file with `file`, `title`, `shows`, `revision` and `alt`. The publisher reads only listed files. A run with no manifests has no key evidence and no screenshot section.

The tester also writes `acceptance-journeys/round-<k>.json`: one entry per journey it exercised, with a `JOURNEY-<n>` code numbered after the last round's, a title, the spec scenario it covers, and what to repeat. The ranker takes the Late commit item's journeys from these files, and a retest's tester gets the chosen entries.

### The description

`review/pages.json` lists every round: `round`, `file`, `message`, `status` (current, feedback sent, merged, or Merge refused with the forge's reason) and the time. Each publish, and a successful merge, rewrites the generated block of the description from it. The block holds the change summary, the state line and one entry per round, oldest first. With `archon_url` set, each entry links to `<archon_url>/api/artifacts/<run>/review-page-round-<n>.html`. Otherwise, each entry names its round and the run, and the block says to open the pages from Archon's UI or with the `implement-change` skill.

### Codes

New codes are a word and an unpadded number. Numbering and parsing accept both the new and the old forms:
- `logs.ts` numbers `DECIDE-<n>` and `DISPUTE-<n>`.
- `review.ts` names findings `REVIEW-<n>`.
- `evidence.ts` matches `JOURNEY`, `HUMAN`, `AT` and `HT` codes.
- `review-inventory.ts` parses both dispute forms.
- `review.ts` stops writing the decision log's pending-decision field. A blocked step's open question goes into its Failure item.

The checklist, review, acceptance and ranking prompts, and the define plugin's `test-plan` skill, write the new codes. Codes cited from an existing test plan keep that plan's form.

### The skill

The `implement-change` skill in `human-workflows/archon/`:
- gives the person the latest page's address when the run pauses at `wait-for-review`;
- finds a run's latest page from a change name or a pull request, by its run id and `review-page.html`.

## Decisions

- **One loop, ended by its wait.** It reuses every tail node and needs no limit of its own. Its `until_bash` only ends it once a pass has written the run's outcome. The alternative was a separate workflow per round, but that loses the run's worktree, sessions and history.
- **The page reads the occurrence just before sending.** The page is written before the wait exists, so it can't embed the occurrence.
- **The round is checked twice.** The page checks it against the wait's message. `start-round` checks it against `review/pages.json`. The second check catches an old tab that keeps the policy it loaded with, and a CLI answer that names an old round.
- **Only the named pages can answer.** The other option opened the two addresses to every HTML artifact in the run, which would let an agent-written page merge.
- **Retest reports and does not fix.** Fixing within the round would put the acceptance loop inside the review loop. A failed retest is a red item, and the next round can fix it.
- **A retest clears only the commits its page listed.** Moving the accepted head would also clear the round's own fixes, which no journey was chosen for.
- **Reported failures wait, and outright agent failures fail the run.** Archon opens no wait in a loop pass after a node failed. Turning node failures into reported ones would need another fork change. `start-round` reads the run files instead, so resuming a failed run continues its round.
- **Merge follows the page's rule from every source.** A typed `merge` doesn't merge when the page would hide Merge. The person can still merge on the forge.
- **Plain text is accepted.** A person answering from the CLI or the UI has no page to make JSON. `merge` merges, and anything else is a note.
- **The CI rule is split between code and the ranker.** Code can't reliably tell which tests CI runs. When finalize passed with checks and the cited test exists, it keeps the row required at yellow instead of red, and the ranker decides.
- **Same implementor session.** It knows why it made the decisions the feedback questions. The cost is one uncached read of the session at the start of each round.
- **Items are known by their source codes.** That keeps an answer attached to its item across rounds without page-specific ids.

## Risks / Trade-offs

- **A skipped wait must end the pass cleanly.** The first fixtures must prove that a pass whose wait is skipped completes the loop under `on_exhausted: complete`.
- **The round number in the wait's message must not trigger Archon's one-time re-ask.** A fixture covers a stale pass that waits again.
- **An answered run needs a host.** It continues only under `archon serve`, or after `archon workflow wake`. The page shows Archon's notice when the answer was accepted but nothing will resume the run. The host process needs cloc, bun, the agents' logins and the forge login the pack expects. The skill checks them when the run pauses.
- **A pull request merged or closed on the forge is noticed only at the next answer.** Until then the run waits.
- **A paused run must survive an Archon restart,** with its worktree and its implementor session id. This needs a manual trial before the first real use.
- **A round's first implementor turn reads the whole session uncached.** Measure it in the first real feedback round before deciding on compaction.
- **A spec edit after the archive lands in `openspec/specs/`.** The archived change no longer shows the final spec.
- **Archon's dry run skips loop exits.** Fixtures can't reach a second pass, so the round paths are covered by script tests and a live trial.

## Migration Plan

1. Merge the fork's `pages` change into its `dev`, and build the Archon the pack runs with from it.
2. Land the pack change with `review_wait` defaulting to `true`.
3. The evaluation harness adds `review_wait: false` to its pack defaults, as its own change. Its defaults apply only when the pack declares the setting. That works on this branch and on pack main, so runs end after publishing as they do today.
4. To roll back, set `review_wait: false` in `.archon/packs/codagent.yaml`. The run then ends after the first page, and the description still links to it.

## Open Questions

None.
