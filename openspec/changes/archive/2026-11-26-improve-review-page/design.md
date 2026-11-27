## Context

The review page and review loop from `add-review-page` live in the pack at `factory-workflows/archon/.archon/workflows/codagent/`. Paths below are relative to it: `.shared/lib/` for the shared code, `implement-change/` for the workflow (`implement-change.yaml`), its scripts and its prompts (`commands/`). Tests are in `factory-workflows/archon/tests/` and run with `bun test tests/`. Workflow fixtures are `implement-change/fixtures/*.stubs.yaml`, run by `bun tests/run-fixtures.ts`.

Current state this design changes:

- **Push.** Every push goes through `acceptancePush(exec, pushed)` in `.shared/lib/pull-request.ts`. It refuses a detached `HEAD` or uncommitted tracked changes, then runs one `git push` to the upstream, or `git push --set-upstream origin <branch>`. It does not fetch, merge, retry or classify the failure. Its callers are:
  - `scripts/acceptance-push.ts`, with `on_failure: report` writing `acceptance-stop.txt` and a failed `acceptance` step;
  - `finish-run.ts`: `finalize-push`, `push-ci-fix` and `push-recheck`;
  - `review-work.ts`: `pushRound`.

  Each push is a trio of nodes in `implement-change.yaml`: the push, a `repair-push` agent when it failed, and a recheck. A recheck failure is recorded and the run goes on to the page. `review-inventory.ts` (`acceptancePushResult`, and `push-round` in `failedItems`) turns a failed push into a red item.
- **Ranking.** The ranking schema is inline JSON on the `rank-review` node (anchor `&ranking`, reused by `repair-ranking`). It has the tiers `red`, `orange`, `yellow` and `white`, an `evidence` string and `keyEvidence: [{file, title, shows}]`. Each item has `type`, `title`, `detail`, a string `link`, `source`, `questions` and `journeys`.
  - `review-package.ts` checks the ranking (`checkRanking`) and places what is missing (`placeRanking`).
  - It rejects any ranker item citing `failure:<step>`.
  - `review-inventory.ts` builds the required items from the checklist, the disputes, the late commits and the failed steps. Decisions are not required at all.
  - A failed step's item shows the step's raw `problems` text.
- **Links and codes.** `review-links.ts` resolves a `link` string to a GitHub URL, or to a relative run file. It also builds `data.codes`, which the page uses to render codes as "code · title" links.
- **Page.**
  - `publish-review.ts` renders `review-page-round-<n>.html` from `pageHtml(data)`. It inlines `review-page.css`, `review-send.ts` and `review-page.js` and embeds one JSON `data` block.
  - `data` holds the state line, the codes, both logs as raw markdown, and the tiers.
  - The publisher takes the head from `git rev-parse HEAD` and never checks it against GitHub.
- **Evidence.** The tester writes screenshots to `acceptance-screenshots/round-<k>/` with a `manifest.json` of `{file, title, shows, revision, alt}`. `review-media.ts` reads them, and manifest problems become a red `review-media` failure item. Commands the tester ran appear nowhere.

The reference mockup for this change is `openspec/changes/improve-review-page/mockup/review-page.html`.

## Goals / Non-Goals

**Goals:**
- Every push merges in what GitHub has, retries what is passing, sends to an agent only what an agent can fix, and fails the run when it still fails.
- No page for a head GitHub does not have.
- Command evidence next to screenshots, checked against the saved output.
- Concerns written for a person, with labeled GitHub links, three tiers and every open decision and dispute.
- The page from the mockup.

**Non-Goals:**
- Changing the pull request description. It keeps its state line.
- Checking the wording of items in code.
- Committing evidence files to the branch.

## Approach

### Push

`acceptancePush(exec, pushed, sleep)` returns `{ ok, problems, person }`. `person` is true for a failure that goes to no agent. It runs these steps:

1. **Detached `HEAD` or uncommitted tracked changes.** It fails as today, with `person` false.
2. **Fetch.**
   - With an upstream, it fetches `git fetch <remote> <mergeRef>`.
   - Without one, it fetches `git fetch origin <branch>`. "couldn't find remote ref" there means there is nothing to merge.
3. **Merge.** When `git merge-base --is-ancestor FETCH_HEAD HEAD` fails, it runs `git merge --no-edit FETCH_HEAD`. On a conflict it lists the files with `git diff --name-only --diff-filter=U`, runs `git merge --abort`, and fails with `person` false. It says the branch moved on GitHub and names the files.
4. **Push.** It pushes as today, never with `--force`, `--force-with-lease` or `--no-verify`.

Fetch and push share one network runner:

- **Environment.** Git runs with `GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=never`, so a bad login fails at once instead of prompting. `Exec` in `.shared/lib/exec.ts` gains an optional `timeout`, passed to `spawnSync`. Fetch and push get 5 minutes.
- **Classification.** It sorts the combined output:
  - **Transient:** a timeout, `Could not resolve host`, `Connection timed out`, `Connection reset`, `Operation timed out`, `RPC failed`, `early EOF`, `remote end hung up unexpectedly`, or `returned error: 5xx`, `HTTP 5xx`, `Internal Server Error`, `Bad Gateway`, `Service Unavailable`. It is retried 3 times, after 10, 30 and 90 seconds, through `Sleep`. If it is still transient, the failure is `person`: "GitHub was unavailable after 3 retries: <last error line>. Resume the run when GitHub is back."
  - **Credentials:** `Authentication failed`, `could not read Username`, `Invalid username or password`, `terminal prompts disabled`, `Permission denied (publickey)`, `returned error: 401` or `403`. The failure is `person`: "GitHub refused the push because the credentials are expired, invalid or lack access. Log in again, then resume the run."
  - **Workflow scope:** `refusing to allow` … `workflow`. The failure is `person`: "GitHub refused the push because it changes `.github/workflows` and the token lacks the `workflow` scope. Push with a token that has it, or ask a person to push, then resume the run."
  - **Anything else** goes to the repair. That includes a pre-push hook, whose output can be any text.

**How Archon resumes.** A failed node fails the run. On resume, Archon restores the top-level nodes that completed and reruns the failed one. A node that fails inside a `loop_group` fails the group, and the resume starts the loop again at its first pass with the whole body rerun (`loop-group/resume.ts` and `iteration.ts` in the fork). So a push may fail its node only where a resume of that node is what we want.

**Push trios.** Four trios keep one shape: `push-round`, `finalize-push` and `push-ci-fix` in the review loop, and `push-recheck` after the acceptance rounds, which now runs on every path.

- **The push node** fails (exit 1, message on stderr) when `person` is true. Otherwise it prints `{ ok, problems }`.
- **The repair** (`repair-push`) runs when `ok` is `false`.
- **The recheck always pushes.** The repair's `blocked` and `reason` are only added to its failure message. It fails (exit 1) on any failure.

**In the acceptance rounds**, the trio (`acceptance-push`, `repair-acceptance-push`, `recheck-acceptance-push`) never fails its node, since a resume would rerun acceptance from round 0:

- `acceptance-push` prints `{ ok, problems, person }` and exits 0. When `person` is true, it ends the rounds at once and the repair is skipped.
- `recheck-acceptance-push` keeps its report mode: on any failure it ends the rounds.
- Ending the rounds goes through `endAcceptance` with a new `push` flag. It writes `acceptance-stop.txt` and records the `acceptance` step as failed with `push: true` and the push's problems.

**After the rounds**, `push-recheck` runs after `recheck-unverified` on every path, before `end-after-acceptance` and before `review-rounds`, which gains it in `depends_on`:

- When the rounds ended on a failed push (`acceptance` recorded with `push: true`), it pushes once and fails at once on any failure, with no repair. It is the node a resume reruns.
- Otherwise its push goes to its repair and recheck like the other trios. It pushes the checklist commit from `recheck-unverified`, or nothing new.

When a resumed `push-recheck` succeeds, the run goes on with acceptance failed. Its fixed line says acceptance stopped because the push failed (see Failed steps). The reviewer can choose Retest on the page.

**In the review loop**, a failed push fails the group, and the resume starts the loop again. `start-round` already rebuilds the round: a page marked `feedback sent` with a saved answer begins that feedback round again (`resumePending`), and with no page it begins the first pass. The body then reruns in full, so `address-feedback` runs again over its own commits. One fix: `roundOutput` sets `archive_needed` to `!archived` in every mode. Today the first pass always sets it, so a resumed first pass would run an archive that already passed.

**Agents never push.** `repair-push`, `repair-ci-wait` and `repair-acceptance-pr` commit and never push. `open-draft-pr`, before acceptance, is unchanged. The node after each repair pushes through `acceptancePush` before its own work:
- after `repair-push`, its recheck;
- after `repair-ci-wait`, `mark-ready-after-repair` and `mark-ready-after-final-repair`, through a new `push` input to the `mark-ready` op;
- after `repair-acceptance-pr`, `recheck-acceptance-pr`, through a new `push` input to `check-draft-pr`.

These pushes have no repair of their own. In the acceptance rounds, a failure there ends the rounds as above. In the review loop, it fails the node.

**Removed:**
- push entries in `finalize-results.json`, which are no longer terminal;
- `pushRecheck`'s failed `acceptance` step;
- `acceptancePushResult`, and `push-round` in `failedItems`;
- the "unless finalize pushed it" text in `scripts/acceptance-push.ts`.

**Prompts that push.**
- `commands/repair-push.md`: when the branch moved on GitHub, the agent merges `FETCH_HEAD` in, resolves conflicts keeping both sides' intent, and commits. When a hook failed, it fixes the cause and commits. It never pushes, rebases, forces or skips hooks. It reports `blocked` only for what a person must do.
- `commands/repair-ci-wait.md` and `commands/repair-acceptance-pr.md`: the agent fixes the workspace and commits, and leaves the push to the workflow.

### Head check before publishing

`publishPackage` compares `view.pr.head_revision` with `git rev-parse HEAD`. When they differ, it looks the pull request up again up to 10 times, 3 seconds apart, like `checkDraftPr`. If they still differ, it throws: "The pull request's head on GitHub is <x>, not the local head <y>. Push the branch, then resume the run." `publish-review-package` already exits 1 when it throws, so the run fails and no page is written.

### Logs in feedback rounds

`commitLogs` in `.shared/lib/logs.ts` also writes `review/log-state.json`: how many entries of the run's `decision-log.md` and `dispute-log.md` the committed logs hold.

A new finish op, `sync-logs`, runs right before `finalize-push` on every pass that runs the tail. It appends the run logs' newer entries to the committed logs, numbered after the highest id there, commits both logs with `--only`, and updates the state. A retest tester's decisions reach the committed log before finalize's push puts them on GitHub. A failure is recorded as the `logs` step, as `commitLogs` does.

`address-feedback` still writes its decisions and its `Settled in review round <n>` markers straight into the committed logs. It now also marks a decision entry that only records the reviewer's answer.

### Command evidence

- **Manifest.** The tester writes `acceptance-commands/round-<k>/manifest.json` as an array of `{ title, shows, revision, command, excerpt, output }`. `output` is the basename of a text file in the same folder that holds the full output.
- **Reader.** `commands(dir, problems)` in `review-media.ts` reads it with the same manifest helper as screenshots. Before comparing, it strips ANSI escape sequences from the output and the excerpt, normalizes line endings and drops the excerpt's trailing newline. It reports a problem, and drops the entry, when:
  - a field is missing;
  - the output file is missing;
  - the excerpt is more than 20 lines;
  - the excerpt is not a run of whole lines in the output.
- **Problems.** These join the screenshot problems in the existing `review-media` failure.
- **Identity.** An entry's identity is its output path, `acceptance-commands/round-<k>/<output>`.
- **Return value.** `reviewMedia` returns `{ shots, commands, journeys, problems }`.
- **For the ranker.** `prepare-ranking` writes `review/evidence.json`, listing every accepted screenshot and command with its path, round, title and what it shows. The ranker picks from it.

### Ranking shape

In the schema in `implement-change.yaml` and the types in `review-inventory.ts` and `review-questions.ts`:

- **Top level:** `red`, `orange`, `yellow`, `evidence` and `keyEvidence: [{ file, title, shows }]`. `white` is gone. `file` names a screenshot path or a command output path.
- **Item:** `type`, `title`, `detail`, `links: [{ label, target }]`, `source`, `questions`, `journeys` and `evidence`. `evidence` is a command output path, or `""` for none. `TYPES` loses `Verification`.
- **Link targets:**
  - `<committed path>` or `<committed path>#L<a>-L<b>`;
  - `commit:<sha>`;
  - `log:DECIDE-<n>` or `log:DISPUTE-<n>`.

`checkRanking` also rejects:
- an item with no links, unless it is the red item citing `failure:<step>`, whose cause may show only in run files;
- a target that does not resolve (below);
- an `evidence` that is not an accepted command;
- a `failure:<step>` source when that step did not fail, or when two items cite it, or on an item that is not red.

The rejection of ranker failure sources and `withoutStepFailures` go.

### Required items and settlement

- **Decisions.** A new `decisionItems` reads the committed decision log's `## DECIDE-<n>:` entries, and the old `D-<n>` form. Each open entry is required at yellow, with the type Agent decision.
- **Disputes.** `disputeItems` requires every open entry: spec-change at red, a pull request comment at yellow, others at orange.
- **Open.** An entry is open unless it says `Settled in review round` or its source is dismissed.
- **Settlement.** A response entry names one source. `responseStatuses` reads the items and their questions from the `page-data` embedded in the answered round's page, as `recapLinks` does, and expands an entry to the other sources of its item only through a shared question:
  - A source that has a question of its own (a question with `source`, as `disputeChoices` makes for each spec-change dispute) takes only its own entry.
  - The item's other sources share its remaining questions. An entry for any of them applies to all of them, unless one has an entry of its own, which wins.
  - So a grouped decision item answered once settles every decision in it, and a declined spec-change dispute stays open beside a fixed one.
- **Fallback text.** When `placeRanking` places an item itself, it writes it plainly:

  | Source | Title | Body | Link |
  | --- | --- | --- | --- |
  | Decision | The entry's heading, without its code | "An agent decided this on its own. It is still open." | "How the agent decided", to `log:DECIDE-<n>` |
  | Dispute | The entry's heading, without its code | "This dispute is still open." | "What was disputed", to `log:DISPUTE-<n>` |
  | Checklist row | The row's behavior | "Acceptance did not verify this." or "This failed in acceptance." | "The checklist row", to the committed checklist's line |

### Failed steps

`failedItems` becomes `stepFailures`, returning each failed step with a fixed line and a fixed "what is left" sentence. Neither is the step's raw `problems`.

| Step | Fixed line |
| --- | --- |
| acceptance | "Acceptance did not converge after <n> rounds.", or with `push: true`, "Acceptance stopped after round <n> because the push failed." |
| archive | "The archive did not pass." |
| finalize | "Finalize did not pass." |
| retest | "The retest did not pass." |
| merge-base | "Merging in the base branch needs a person." |
| address-feedback | "Addressing the feedback was blocked." |
| check-response | "The response to the feedback failed its check." |
| description | "The pull request description was not updated." |
| review-media | "Some acceptance evidence could not be shown." |

For each failed step, the publisher looks for the red ranker item citing `failure:<step>`.
- **Found:** it keeps that item's text and sets its `failLine`.
- **Not found:** it writes a plain item with:
  - a title from the step, such as "Acceptance did not converge";
  - the fixed line;
  - the "what is left" sentence;
  - the standard question;
  - no links.

### Links

`review-links.ts` replaces `sourceLink` and `codeLinks` with `resolveTarget(target, ctx)`. It returns `{ href }` or `{ problem }`, and both the check and the publisher use it. `ctx` holds the forge base URL, the head and the change folder at the head.

- **A path** must exist at the head (`git cat-file -e <head>:<path>`). It becomes `<base>/blob/<head>/<path>#L<a>-L<b>`.
- **A commit** must be in the pull request: an ancestor of `HEAD` and not of `origin/<base>`. It becomes `<base>/commit/<sha>`.
- **A log entry** resolves to its heading's line through the line before the next heading in the committed log at the head.

The header's log links are the blob URLs of the logs that exist at the head. The pull request link is `<base>/pull/<n>`. `data.codes` and every relative run-file link go.

### Late commits

`laterCommits` lists every commit after the accepted head that is not on the base branch:
- every non-merge commit;
- each merge only when `git show --remerge-diff` shows that resolving it changed files.

A commit someone pushed to the branch on GitHub, merged in by any push, is listed. A clean "Update branch" merge is not.

**A fresh base.** The local `refs/remotes/<remote>/<base>` is as old as the launch fetch, or the last `merge-base`. After "Update branch" on GitHub, the base commits it brought in are not on that ref, so they would be listed as late commits. So `prepare-ranking` first fetches the base branch from the configured remote, with the push's network runner and retries. `reviewRevisions` then excludes commits reachable from that ref as well as from `merge-targets.json`'s recorded target. When the fetch still fails, the ref stays as it was, and the worst case is listing too many commits, never hiding one. The commit check in Links uses the same ref.

### Page

**Data.** `data` loses `codes`, `decisions`, `disputes` and `state`. It gains:
- `pullRequestUrl` and `logs: { decisions?, disputes? }`;
- `forgeBase`;
- `commands` by round, each with path, round, title, shows, command and excerpt;
- on each item: resolved `links: [{ label, href }]`, `failLine`, and its `evidence` command entry. A failed step's item may have no links, and then the page shows no "On GitHub" block.

Key evidence entries carry their kind.

**`review-page.js`.** It renders the mockup's layout:
- the header: round and repository, then the pull request, reviewed head, run, logs and the concerns total, colored by the highest tier present;
- the summary;
- key evidence with screenshots and commands;
- all acceptance evidence by round, with the round's recap, commands as collapsible rows and screenshots;
- one Concerns section with High, Medium and Low groups and counts;
- the concern layout: tags, title, fail line, text, embedded command, questions, then "On GitHub" links;
- the contents list with tier subheadings, counts and full wrapped titles.

Text changes in the renderer:
- `inline()` no longer links codes. `[label](href)` becomes a link only when `href` starts with `forgeBase`. `file:` and other hosts show as the label.
- `prose()` splits a paragraph into runs. A run of `- ` or `* ` lines becomes a list, and other lines a paragraph, so a lead-in line above a list works.
- A question's legend no longer shows its source code.

**Comments on commands.**
- `review-send.ts`'s `collectReview` adds `commandComments: [{ ref, round, comment }]`.
- `parseAnswer` in `review-round.ts` keeps `commandComments` next to `answers` and `screenshotComments`, so the saved `review-answers-round-<n>.json` holds them and `address-feedback` reads them.
- The answered-page record restores them.
- `checkResponse` in `review-work.ts` accepts command paths as item ids, from the saved answer's `commandComments`, like screenshot paths.

**CSS.** `review-page.css` takes the mockup's styles, including the question box's block layout, the chips and the title without a width cap.

**Template.** `pageHtml` drops `#state`. The pull request description keeps its state line from `stateLine`.

### Prompts

- **`rank-review` and `repair-ranking`:**
  - three tiers and the wider orange rule;
  - every open decision and dispute;
  - plain titles and bodies with no codes, paths, line numbers or agent history;
  - labeled link targets instead of paths;
  - `failure:<step>` items written from the tester's report and the step results;
  - `evidence` for a defect;
  - key evidence from `review/evidence.json`.
- **`acceptance-test`:** record command evidence in the round's manifest, with the full output saved beside it, and never secrets in a command or an excerpt.
- **`address-feedback`:** address command comments, and mark decision entries that only record the reviewer's answer as settled.
- **`repair-push`, `repair-ci-wait` and `repair-acceptance-pr`:** as above.

## Decisions

- **Unrecognized push failures go to the repair.** A hook's output can't be recognized, and the repair can still report `blocked`. Only failures recognized as a person's are kept from agents.
- **The recheck always pushes.** Otherwise a resume after a person fixed the login would replay the repair's `blocked` and fail again.
- **Push failures fail the node.** They used to be recorded and reported. Archon then stops the run, keeps it resumable, and opens no wait. A failed push now writes no page.
- **In acceptance, a failed push ends the rounds, and the push after them fails.** Failing inside the rounds would make a resume rerun acceptance from round 0, a whole tester pass, with the CI wait checking a head that was never pushed. The cost is that a resumed run does not run the rounds it had left. The page says acceptance stopped because the push failed, and the reviewer can choose Retest.
- **A feedback round's push fails inside the loop.** The page and the wait are in the loop, so there is no node after it to fail instead. `start-round` already rebuilds the round on resume.
- **Agents never push.** Every push then fetches, merges, retries and classifies the same way, and an agent's push cannot hide a failure from the workflow.
- **A failed failure item may have no link.** Bad evidence or a rejected response shows only in run files, which the page never links. Requiring a link there would make the ranker invent one.
- **A stale base lists too much, never too little.** When the base fetch fails, extra late commits are listed rather than the run failing.
- **No automatic commit before a push.** Uncommitted changes mean unfinished or stray work, and review reads commits. The repair resumes the session that made the changes.
- **Logs sync before finalize's push.** The committed logs must be on GitHub before the page links to them, and the head check would refuse a page with an unpushed log commit.
- **A command is known by its output path.** That reuses the `file` field of key evidence and keeps the ranking's shape close to today's.
- **Color codes are stripped.** The excerpt check and the page compare and show plain text.
- **The fixed failure line comes from code.** The ranker writes the explanation. The line saying what failed is always present and always true.

## Risks / Trade-offs

- **Classification misses a message.** An unknown wording falls to the repair, which costs one agent turn but is safe.
- **Resume behavior.** The design relies on how Archon's resume treats a loop: completed top-level nodes restored, a failed loop started again at its first pass. A scratch workflow with both shapes must show a resumed push failure pushing again, without rerunning acceptance. A resumed feedback round reruns `address-feedback` over its own commits, which costs one agent turn.
- **A failed push in a feedback round leaves no new page.** The reviewer learns of it from the run's failure, which the `implement-change` skill reports, not from a page.
- **Secrets in command output.** Excerpts are on the page and full output stays in the run folder. The tester prompt forbids secrets. The page shows excerpts as text only.
- **Eval harness.** `review-attention.json` loses `white` and `link`. Before the first eval rep, check whether the and-scene judges read it, the package, or a run's failure state.

## Migration Plan

1. Land the pack change. Runs already started keep the pack they froze at start.
2. **BREAKING** for readers of `review-attention.json`: `white` is gone, and `link` becomes `links`. Pages already written are static and keep working.
3. Before the first eval rep, make any harness change the check above finds, as its own PR that works with both the branch and pack main.
4. To roll back, revert the pack change. Nothing else depends on it.

## Open Questions

None.
