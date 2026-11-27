## Coverage Strategy

Specifications remain the source of unit-test requirements. This plan records only additional integration and end-to-end obligations, the acceptance testing envelope, and exceptional human-only obligations.

This change is for the Archon pack in `factory-workflows/archon/`. Workflow paths below are relative to `factory-workflows/archon/.archon/workflows/codagent/`. Node and function names are the ones `design.md` gives.

The pack has two automated layers, and both run in the archon CI job. New tests go into the existing files named below.

- **bun tests** in `factory-workflows/archon/tests/*.test.ts`, run by `bun test tests/`. They build real temporary git repositories with `tests/helpers.ts`, with fake `archon`, `gh`, `openspec` and `cloc` commands. `review-page.test.ts` renders the page script against a small fake DOM.
- **Archon dry-run fixtures** in `implement-change/fixtures/`, run by `bun run test:fixtures`.
  - Agent nodes are stubbed.
  - A stub cannot make a node fail. A fixture that expects a failure leaves that node unstubbed and sets `exec-code: true`, so the real script runs in a scratch worktree with no remote and fails there.
  - A dry run reaches only a loop's first pass.

Each risk goes to the cheapest layer that catches it:

- **The push** runs git against a real bare remote in bun tests. Its error handling and timeout run against scripted git output, because a local remote cannot produce GitHub's errors.
- **Routing** after a failed push is a fixture matter. A wrong `when:` or `trigger_rule` would publish a page after a push that still failed, or skip the recheck.
- **The inventory, settlement, links, the ranking check, the evidence readers and the publisher** read the run's files, git and the forge, so bun tests run them against real repositories and run folders.
- **The page's rendering** is code that builds markup from data. bun tests run it with the fake DOM and assert which branch rendered and that the data went in, not the static wording.
- **Real Archon, real GitHub, real agents and a browser** are covered by the acceptance pass:
  - how a resumed run treats a push that failed in a loop and after one;
  - GitHub's real refusal messages;
  - the page's look against the mockup;
  - the tester recording command evidence;
  - the ranker writing plain items.

The prompt changes (`rank-review`, `repair-ranking`, `acceptance-test`, `address-feedback`, `repair-push`, `repair-ci-wait`, `repair-acceptance-pr`) are static content and get no tests.

## Integration Tests

### INTEG-1: Every push merges in the remote, retries what is transient, and sorts what fails
- **Covers:** acceptance-rounds:
  - "Every push brings in the remote first";
  - "Transient push errors are retried";
  - "Some push failures are left to a person";
  - "A push that still fails fails the run";
  - "A failed acceptance push ends the rounds";
  - "A fix is pushed without force".
- **Boundary:** `acceptancePush` in `.shared/lib/pull-request.ts` with real git, a bare remote and `Exec`. Also `scripts/acceptance-push.ts` run as a process.
- **Setup:** a temporary repository with a bare origin and a branch with an upstream, plus a second clone that pushes to the branch. Cases:
  - the second clone pushes a commit touching other files;
  - the second clone pushes a commit touching the same lines;
  - a branch with no upstream and no remote branch yet;
  - a pre-push hook that fails;
  - uncommitted tracked changes;
  - a detached `HEAD`.

  For the errors a local remote cannot give, a fake exec returns scripted output for fetch and push:
  - a timeout, then success;
  - a server error twice, then success;
  - a server error on all four tries;
  - each credentials message;
  - the workflow-scope refusal;
  - an unrecognized message.

  A recording sleep replaces waiting.
- **Action:** call `acceptancePush`. For a person failure and a repair failure, also run `scripts/acceptance-push.ts` and the `push-recheck` op as their nodes run them.
- **Assertions:**
  - The other clone's commit is merged in with a merge commit and pushed. The remote's history keeps both clones' commits, and nothing was rebased or forced.
  - A conflict:
    - leaves no merge in progress and a clean tree;
    - fails with `person` false;
    - names the conflicting files.
  - With no upstream, the push sets the upstream on `origin`.
  - Retries:
    - A timeout and two server errors are retried, and the push succeeds after sleeps of 10 and 30 seconds.
    - Four server errors fail with `person` true after sleeps of 10, 30 and 90 seconds.
  - Credentials and workflow-scope failures fail with `person` true and no sleep.
  - A hook failure, an unrecognized message, uncommitted changes and a detached `HEAD` fail with `person` false.
  - Fetch and push run with `GIT_TERMINAL_PROMPT=0` and a timeout.
  - In the acceptance rounds the script never exits 1:
    - A person failure prints `{ ok: false, person: true }`, writes `acceptance-stop.txt`, and records the `acceptance` step failed with `push: true`.
    - A repair failure prints `{ ok: false, problems }` and ends nothing.
    - As the recheck, any failure ends the rounds the same way, even when the repair reported `blocked`, and it pushes when the remote now accepts.
  - The `push-recheck` op:
    - after rounds that ended on a push, exits 1 on any failure and prints nothing for a repair to read, then pushes on a second run once the remote accepts;
    - otherwise prints `{ ok: false, problems }` for its repair.
- **Execution:** `factory-workflows/archon/tests/pull-request.test.ts`, CI archon job.

### INTEG-2: A push that still fails after its repair fails the run, with no page
- **Covers:**
  - acceptance-rounds: "A push that still fails fails the run" (Hook still fails after the repair), "A failed acceptance push ends the rounds" (Acceptance push still fails), "Rows still not verified are rechecked after the rounds" (Run stops after acceptance, Run goes on after acceptance);
  - pull-request-finalization: "The pull request is pushed and marked ready after the archive" (Push still fails), "The run ends in one of three states" (Failed);
  - review-response: "A feedback round addresses the feedback and publishes again" (Push still fails in a feedback round);
  - review-handoff: "Every run whose acceptance rounds end writes a review page" (Push still fails);
  - pack-settings-and-run-files: "A failed step after the acceptance rounds does not stop the run" (Acceptance push still fails), "A failed step in a feedback round does not stop the run" (Push fails in a feedback round).
- **Boundary:** the push trios in `implement-change.yaml` (push, `repair-push`, recheck), with their `when:` and `trigger_rule`, including `push-recheck` on every path with its repair and recheck.
- **Setup:**
  - Change three fixtures: `finalize-push-blocked`, `ci-push-repair-blocked` and `feedback-push-failed`. Each:
    - stubs the first push with `ok: false`;
    - stubs the repair as blocked;
    - leaves the recheck unstubbed, with `exec-code: true`.
  - Change `push-repair-blocked` the same way for the acceptance trio, and leave `push-recheck` unstubbed too.
  - Add a fixture like `stop-after-acceptance` in which `push-recheck` reports `ok: false`, its repair is stubbed, and its recheck runs for real.
  - `push-repaired` stays as it is.
- **Action:** `archon workflow test` through `bun run test:fixtures`.
- **Assertions:**
  - `push-repair-blocked` expects `failed` with `fail-node` `push-recheck`, outside any loop group. It reaches `write-acceptance-status` and `list-unverified`, and no repair after `push-recheck`.
  - each other changed or new fixture expects `failed`, with `fail-node` naming its recheck (and its loop group in a feedback round), and reaches its repair;
  - none reaches `publish-review-package`, `rank-review` or `wait-for-review`;
  - `push-repaired` still completes and publishes, reaching `push-recheck` before `review-rounds`.
- **Execution:** `implement-change/fixtures/`, CI archon job.

### INTEG-3: The publisher writes no page for a head GitHub does not have
- **Covers:** review-handoff "Every run whose acceptance rounds end writes a review page" (Head is not on GitHub).
- **Boundary:** `publishPackage` in `.shared/lib/publish-review.ts` with a real repository and the fake forge's `pr.view`.
- **Setup:** a run folder ready to publish. The fake forge reports one of these:
  - the local head;
  - an older head twice, then the local head;
  - an older head on every lookup.

  A recording sleep replaces waiting.
- **Action:** run the publish op.
- **Assertions:**
  - The first two cases write the page.
  - The third fails the op after its retries, with a message naming both heads. It writes no `review-page-round-<n>.html`, no `review-page.html` and no `review/pages.json` entry, and makes no description edit.
- **Execution:** `factory-workflows/archon/tests/review-package.test.ts`, CI archon job.

### INTEG-4: Decisions recorded after the logs were committed reach the committed log before finalize's push
- **Covers:** review-handoff "A decision log records what the definition did not settle" (Decision after the logs are committed, Tester decides in a retest, Log commit fails).
- **Boundary:**
  - `commitLogs` and the new `sync-logs` op in `.shared/lib/logs.ts` and `finish-run.ts`, with a real repository and run folder;
  - the feedback round's node order in `implement-change.yaml`.
- **Setup:**
  - A repository whose logs were committed by `commitLogs`, with the change archived so the committed logs are in the archive folder.
  - The run's `decision-log.md` and `dispute-log.md` gain new entries afterwards, including one in the old `D-<n>` form.
  - A case where the commit cannot be made.
  - For the routing, the feedback-round fixtures (`feedback-round`, `feedback-retest`) stub `sync-logs`.
- **Action:**
  - run `sync-logs` twice;
  - run `archon workflow test` for the fixtures.
- **Assertions:**
  - After the first sync, the committed logs in the archive folder hold the new entries, numbered after the highest id already there, in one commit touching only the two logs.
  - `review/log-state.json` holds the new counts.
  - The second sync makes no commit.
  - A failed commit records the `logs` step as failed, and the op still exits 0.
  - The fixtures reach `sync-logs` before `finalize-push`, and the first-pass fixtures (`happy-path`) do not reach it.
- **Execution:** `factory-workflows/archon/tests/review-package.test.ts` and `implement-change/fixtures/`, CI archon job.

### INTEG-5: Required items, settlement, links and the ranking check work across rounds
- **Covers:**
  - review-handoff:
    - "A script checks the ranking";
    - "Every item is ranked in one tier";
    - "Each failed step is a red item";
    - "Items link to where they show";
    - "The check covers questions and key evidence";
    - "The fallback keeps the agent's valid questions and picks";
    - "The testing evidence is gathered for the ranking" (Commits follow acceptance, Base branch merged in);
  - pull-request-finalization: "Commits brought in by finalize's push are late commits".
- **Boundary:** `review-inventory.ts`, `review-package.ts` and `review-links.ts` over a real run folder and repository with a bare origin.
- **Setup:**
  - **Decision log:** open entries, an entry marked `Settled in review round 1`, an entry recording the reviewer's answer, and one old `D-<n>` entry.
  - **Dispute log:** a spec-change entry, a pull request comment entry and another kind.
  - **Round 1's answered page:** its embedded `page-data` has:
    - one item grouping two decisions and a dispute under one shared question, and the round's response answers one of its sources;
    - one item grouping two spec-change disputes, each with a question of its own, and the response marks one fixed and the other declined.
  - **Failed steps:**
    - `step-results.json` with acceptance and finalize failed;
    - a ranking with a red item citing `failure:acceptance`;
    - none for finalize.
  - **Commits:**
    - `review/accepted-head.txt`;
    - after it, a commit pushed from another clone and merged in by a push;
    - a clean merge of the base branch made on the remote, as "Update branch" makes, of a base commit made after the local base ref was fetched, so that ref is stale;
    - the same with the remote unreachable when the base is fetched;
    - a merge whose conflict resolution changed files.
  - **Rankings to check:**
    - links to `<path>#L<a>-L<b>` that exist and do not exist at the head;
    - links to `commit:<sha>` in and outside the pull request;
    - links to `log:DECIDE-<n>` and `log:DISPUTE-<n>`;
    - an item with no links, and a red item citing `failure:<step>` with no links;
    - an `evidence` naming an accepted command and an unknown one;
    - two items citing the same failure, a non-red item citing it, and an item citing a step that did not fail;
    - a ranking that still has a `white` tier.
- **Action:** build the inventory, then check and place rankings, valid and invalid.
- **Assertions:**
  - **Required:**
    - Every open decision is required at yellow, the old form included.
    - The settled entries and the entry recording the reviewer's answer are not required.
    - The spec-change dispute is required at red, the pull request comment at yellow and the other at orange.
  - **Grouped answers:**
    - The response to one source of the shared question settles all three of its sources in the next round.
    - Of the two disputes with questions of their own, only the fixed one is settled. The declined one is still required at red.
  - **Link resolution:**
    - A path becomes `<base>/blob/<head>/<path>#L<a>-L<b>`.
    - A commit becomes `<base>/commit/<sha>`.
    - A log entry becomes the committed log's blob URL with its heading's line range.
    - The check rejects the missing path, the outside commit, the item with no links, the unknown evidence, each misuse of a failure source and the `white` tier. It accepts the failure item with no links.
  - **Failed steps:**
    - The ranker's acceptance item is kept, in red, with its fixed line.
    - Finalize gets a placed item with its fixed line, its "what is left" sentence and the standard question, no links, and none of the step's `problems` text.
    - An acceptance step recorded with `push: true` gets the line saying acceptance stopped because the push failed.
  - **Placed items** for a decision, a dispute and a checklist row:
    - take their titles from the heading or the behavior, with no code;
    - each have one labeled link.
  - **Late commits:**
    - The commit from the other clone and the resolving merge are listed.
    - With the stale local base ref, `prepare-ranking` fetches the base first, and neither the clean base merge nor the base commit it brought in is listed.
    - With the remote unreachable, the base commit is listed and `prepare-ranking` still succeeds.
- **Execution:** `factory-workflows/archon/tests/review-package.test.ts`, CI archon job.

### INTEG-6: Command evidence is read, checked and listed for the ranking
- **Covers:**
  - acceptance-rounds: "The tester records command evidence" (No command evidence), "Bad command evidence is left off the page";
  - review-handoff: "The testing evidence is gathered for the ranking" (Command evidence), "The ranking picks the key evidence" (Only command evidence, No screenshots).
- **Boundary:** `commands` and `reviewMedia` in `.shared/lib/review-media.ts`, and `prepare-ranking`, over a real run folder.
- **Setup:** `acceptance-commands/round-1/manifest.json` and `round-2/manifest.json` with:
  - a good entry whose output has ANSI color codes and CRLF line endings;
  - entries with a missing field, a missing output file, an excerpt not in the output, and an excerpt of 21 lines;
  - a round with screenshots only;
  - a run with neither.
- **Action:** read the media, then run `prepare-ranking`.
- **Assertions:**
  - The good entry is kept, with its identity `acceptance-commands/round-<k>/<output>` and its excerpt without color codes.
  - Each bad entry is dropped and named in the `review-media` failure with the screenshot problems.
  - A round with screenshots only reports no command problem.
  - `review/evidence.json` lists the accepted screenshots and commands with their paths and rounds. With neither, the list is empty.
- **Execution:** `factory-workflows/archon/tests/review-page.test.ts`, CI archon job.

### INTEG-7: The publisher's data and the page's rendering follow the item shape
- **Covers:**
  - review-page: "Content order", "Key evidence and screenshots", "Questions", "Screenshot comments", "Read-only content", "Concerns", "Page header", "Links go to GitHub", "Concern layout", "Contents list";
  - review-handoff: "The run's state line" (Page has no state line);
  - review-response: "A feedback round addresses the feedback and publishes again" (Comment on command evidence).
- **Boundary:** `pageHtml` in `publish-review.ts`, the inlined `review-page.js` run against the fake DOM, `collectReview` in `review-send.ts`, the `start-round` op in `review-round.ts`, and `checkResponse` in `review-work.ts`.
- **Setup:** page data written by the publisher from a run folder with:
  - red and yellow items and no orange;
  - an item with a `failLine` and an `evidence` command;
  - a failed step's item with no links;
  - a command entry picked as key evidence and also shown in its round;
  - links in agent text to the forge host, another host and a `file:` URL;
  - a paragraph with a lead-in line before a list;
  - agent text holding `</script>` and `<img onerror>`;
  - a run whose dispute log does not exist.

  A second data set has no concerns.
- **Action:** render each page and collect a review with a comment on the command entry in both places. Send it as the wait's answer to `start-round`, then run `checkResponse` on a response naming the command id.
- **Assertions:**
  - **Data:** the page data has no `codes`, `decisions`, `disputes` or `state`.
  - **Header:**
    - links the pull request and the decision log only;
    - has a concerns total with the red tier's class, and no tier class when there are no concerns.
  - **Concerns:**
    - one Concerns section with High and Low groups and no Medium group;
    - concerns numbered across the groups;
    - the "no concerns" branch with no concerns.
  - **Concern contents:**
    - the fail line and the embedded command, in that order, before the questions and links;
    - no "On GitHub" block on the item with no links;
    - the question legends without source codes.
  - **Agent text:**
    - Only the forge link renders as a link. The others render as their labels.
    - The lead-in renders as a paragraph followed by a list.
    - Agent text renders as text, not markup.
  - **Contents list:** section links and tier entries with counts.
  - **Comments:**
    - `collectReview` returns one `commandComments` entry for the command shown twice.
    - The saved `review-answers-round-<n>.json` that `start-round` writes keeps that entry.
    - `checkResponse` accepts the command id.
- **Execution:** `factory-workflows/archon/tests/review-page.test.ts`, CI archon job.

## End-to-End Tests

None. The real path needs live agents, GitHub, a browser and a running Archon. The acceptance pass covers it under the envelope below.

## Acceptance Testing Envelope

- **Environments and sandboxes:**
  - scratch repositories with bare remotes;
  - a scratch Archon home, started and stopped by the pass, running a script-only workflow over the pack's push script with both shapes the design uses (costs nothing):
    - a loop whose push fails and ends the loop, then a strict push after it: resuming reruns only the push after the loop, and goes on;
    - a loop whose push fails its node: resuming starts the loop again at its first pass;
  - run folders written by the publisher from prepared data, with two acceptance rounds of screenshots and command evidence, all three tiers and a failed step, viewed in headless Chrome at desktop and phone widths, one browser at a time, and compared with `mockup/review-page.html`;
  - the trial repository `pacaplan/archon-live-trial` and its change `add-greeting-config`, through `bun run live-trial`.
- **Credentials and secrets:** the `gh` login and the agents' provider logins on this machine. Run `gh` and pushes with `GH_TOKEN` and `GITHUB_TOKEN` unset. No other secret is needed.
- **Authorized effects:**
  - local scratch repositories, Archon homes and run folders, removed when done;
  - **three throwaway pushes to the trial repository**, through the pack's push, to see GitHub's real refusals:
    - from a scratch clone with a bogus credential helper, for bad credentials;
    - to an unresolvable host, for a network failure and its retries;
    - of a throwaway branch `push-check-<stamp>` changing `.github/workflows`, for the workflow-scope refusal, deleted afterwards if it was created;
  - **one live trial:**
    - with the review wait on: the first page, then one feedback round with a comment on a command evidence entry and a Retest;
    - it spends provider usage for every role, takes about 60 to 90 minutes, and opens a public draft pull request on the trial repository;
    - while it is open, the pass may answer the run from the page, the Archon CLI or the UI, and resume the trial's run;
    - cleanup runs `bun run live-trial cleanup <branch>`.
- **Off limits:**
  - the shared `archon serve` and its runs;
  - Chrome or servers another session started;
  - the trial repository's main, agent-workflows main and the fork's `dev`;
  - the factory and its state;
  - force pushes;
  - the `gh` login, its token scopes and any credential file.
- **Permitted substitutes:**
  - scripted git output for GitHub server errors, which GitHub cannot be made to return;
  - when nothing serves the trial's run, `archon workflow wake` may continue an answered run.
- **Known risk areas:**
  - The failure classes match git's and GitHub's wording. Unknown wording falls to the repair, which is accepted.
  - The recheck must push even after its repair reported `blocked`, or a resume would fail again.
  - The design relies on Archon restoring completed top-level nodes on resume and starting a failed loop again at its first pass.
  - A resumed feedback round reruns `address-feedback` over its own commits.
  - A resumed first pass must not run an archive that passed.
  - `sync-logs` must commit before finalize's push, or the head check refuses the page.
  - The forge can lag behind a push.
  - Grouped settlement reads the answered page's embedded data.
  - In WebKit, the old CSS drew the question box's legend on its top border. The mockup's block layout fixes it.
  - A failed push in a feedback round writes no new page, so the reviewer learns of it from the run's failure.
  - Command excerpts are on the page, so secrets must never be in a command or an excerpt.

## Human-Only Testing

None.

## Coverage Map

| Requirement or journey | INTEG | E2E | HUMAN |
| --- | --- | --- | --- |
| acceptance-rounds: The tester records command evidence | INTEG-6 | - | - |
| acceptance-rounds: Bad command evidence is left off the page | INTEG-6 | - | - |
| acceptance-rounds: Every push brings in the remote first | INTEG-1 | - | - |
| acceptance-rounds: Transient push errors are retried | INTEG-1 | - | - |
| acceptance-rounds: Some push failures are left to a person | INTEG-1 | - | - |
| acceptance-rounds: A push that still fails fails the run | INTEG-1, INTEG-2 | - | - |
| acceptance-rounds: A failed acceptance push ends the rounds | INTEG-1, INTEG-2 | - | - |
| acceptance-rounds: A fix is pushed without force | INTEG-1 | - | - |
| acceptance-rounds: Rows still not verified are rechecked after the rounds | INTEG-2 | - | - |
| pull-request-finalization: The pull request is pushed and marked ready after the archive | INTEG-2 | - | - |
| pull-request-finalization: The run ends in one of three states | INTEG-2 | - | - |
| pull-request-finalization: Commits brought in by finalize's push are late commits | INTEG-5 | - | - |
| review-response: A feedback round addresses the feedback and publishes again | INTEG-2, INTEG-7 | - | - |
| review-handoff: The run's state line | INTEG-7 | - | - |
| review-handoff: Every run whose acceptance rounds end writes a review page | INTEG-2, INTEG-3 | - | - |
| review-handoff: A decision log records what the definition did not settle | INTEG-4 | - | - |
| review-handoff: The testing evidence is gathered for the ranking | INTEG-5, INTEG-6 | - | - |
| review-handoff: Every item is ranked in one tier | INTEG-5 | - | - |
| review-handoff: Each failed step is a red item | INTEG-5 | - | - |
| review-handoff: A script checks the ranking | INTEG-5 | - | - |
| review-handoff: Items link to where they show | INTEG-5 | - | - |
| review-handoff: The ranking picks the key evidence | INTEG-6 | - | - |
| review-handoff: The check covers questions and key evidence | INTEG-5 | - | - |
| review-handoff: The fallback keeps the agent's valid questions and picks | INTEG-5 | - | - |
| pack-settings-and-run-files: A failed step after the acceptance rounds does not stop the run | INTEG-2 | - | - |
| pack-settings-and-run-files: A failed step in a feedback round does not stop the run | INTEG-2 | - | - |
| review-page: Content order | INTEG-7 | - | - |
| review-page: Key evidence and screenshots | INTEG-7 | - | - |
| review-page: Questions | INTEG-7 | - | - |
| review-page: Screenshot comments | INTEG-7 | - | - |
| review-page: Read-only content | INTEG-7 | - | - |
| review-page: Concerns | INTEG-7 | - | - |
| review-page: Page header | INTEG-7 | - | - |
| review-page: Links go to GitHub | INTEG-5, INTEG-7 | - | - |
| review-page: Concern layout | INTEG-7 | - | - |
| review-page: Contents list | INTEG-7 | - | - |
