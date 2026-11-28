# Codagent workflows for Archon

The `codagent` workflow pack for the Archon engine. The README is for people who use the pack; this file is for people who change it. It holds the layout, the forge operations, the files a run writes, and how to test. Paths below are relative to this folder.

## Design balance

Every part of a workflow weighs two goals:

- **The agents reach the right outcome.** Real defects get fixed. Wrong findings get declined, and the declines are accepted. Real disagreements and open questions reach the person with both sides. No agent gives in or holds out for the wrong reason. Give each agent the context, evidence and choices it needs to decide well.
- **The machinery stays small.** Each node, script, piece of state, loop, special case and failure path is more to test and another way for a run to go wrong.

Add machinery only where it clearly raises the chance of the right outcome. Prefer a bounded loop, a clear instruction, or a hand-off to the person over state that tracks every case. When a rare case would need new state or a new failure path, accept the limit and record it in the change's design. A run that leaves an open question for the person is better than one that fails or one that hides the question.

## Layout

Paths are relative to this folder, `factory-workflows/archon/`.

```
.archon/workflows/codagent/          the codagent pack
  implement-change/                  codagent-implement-change: the workflow, commands/, scripts/, fixtures/
  check-definition/                  codagent-check-definition
  commit-definition/                 codagent-commit-definition
  .pack/pack.yaml                    the pack settings and their defaults
  .shared/lib/                       TypeScript modules the scripts share
  .shared/implement-change.md        how the implementor works and tests
  .shared/verify-behavior.md         how the checklist is written and evidenced
tests/                               bun tests for .shared/lib, run-fixtures.ts and live-trial.ts
tests/data/changes/                  sample change definitions the fixtures use
PROVENANCE.md                        where the workflows came from
package.json, biome.json, .jscpd.json, tsconfig.json  lint tools for development; the pack does not use them
```

Every check is a TypeScript script node run by bun. Agents read the two `.shared/*.md` documents through `$PACK_DIR`.

## Rules

- Keep the pack under `.archon/workflows/codagent/`. A workflow's commands, scripts and fixtures sit in its own folder. Modules several scripts import go in `.shared/lib/`, and documents several agent nodes read go in `.shared/`, read through `$PACK_DIR`.
- Write checks as TypeScript script nodes run by bun, importing from `.shared/lib/`. No shell scripts, and nothing specific to one provider.
- Every agent node names a role alias with a tier fallback (`['@implementor', large]`), never a provider, model or effort, and sets `context` explicitly.
- A `context: fresh` node's command starts with the autonomy preamble ("You are running autonomously with no human in the loop...").
- Agents and scripts share the `$ARTIFACTS_DIR` files "What a run writes" below lists. Rename one only everywhere at once.
- With any change to a check, a repair, or a branch condition, add or change a fixture. With any change to `.shared/lib/`, add or change a bun test. Before committing, run both test layers and the lint as the Tests section below describes. None of them makes model calls. Keep the code within the lint limits by restructuring it; do not raise a limit or add a suppression comment.
- Add tests to the existing fixtures and `tests/*.test.ts`. Do not add a test suite or CI job.
- Test only what "What to test" below says to test.
- A live trial (Live trials, below) is available for testing a pack change with real agents. Start one only when the user allows it, in the change's test plan or in conversation, and clean it up when the run stops.
- Only `PROVENANCE.md` names the projects the pack was ported from.
- Commit messages: `type: lowercase description`, with type one of `fix`, `feat`, `chore`, `refactor`, `test`, or `docs`.

## What to test

The pack is code and static content. Test the code. Never test the static content: people review it.

**Static content, never tested:**

- every command file under `<workflow>/commands/`;
- the documents agents read from `.shared/`, such as `implement-change.md` and `verify-behavior.md`;
- any other markdown in the pack, and the wording of a required passage such as the autonomy preamble.

No test or fixture may read these files, quote them, or check that a node's resolved prompt contains text from them.

**Code, tested:**

- `.shared/lib/` modules and the workflows' `scripts/`, with bun tests in `tests/*.test.ts`. That includes the text a script builds or chooses by branch, such as `problems`, reasons, CI reports, handoffs, PR bodies and the review package.
- The workflow YAML's graph, with dry-run fixtures: which nodes a path reaches, branch conditions, repairs and the outcome.
- The YAML's wiring, with bun tests: bindings, settings passed to blocks, timeouts, loop limits, roles, `context`, and output schemas.
- That one node's output reaches the next node's prompt, with a fixture's `resolved-text-contains`. It may name only text that a stub or the test's inputs supply.

## Finish path

- Only OpenSpec changes under the target repository's `openspec/changes/<name>` are supported. Do not restore change-kind settings or provider-specific code.
- The inspection audit runs on `@reviewer` with a large fallback; code review and ranking use reviewer/medium and completion judgment uses tester/medium.
- Keep completion verdict limits and progress checks independent of the judge. Preserve report-mode continuation from the end of acceptance through archive and finalize to the package; earlier checks keep their fatal defaults.
- Commit the decision and dispute logs before archive; later agent entries belong to the committed current change folder. Preserve unrelated index and worktree changes during archive commits.
- PR state and description mutations use the forge. The finalize fixer may reply/resolve comment threads with gh; mark every reply with `<!-- codagent-reply -->`. Merge only on the reviewer’s current-page merge answer and only at the reviewed head when archive and finalize passed.
- Ranking requirements are inventoried independently of the ranking agent. Preserve external PR text and verify the published generated body by reading it back.

## The forge

Scripts reach the pull request through `archon forge <op> --data-file <file>`, run from the exec layer with the argv Archon publishes in `ARCHON_CLI_COMMAND`. They parse the JSON envelope: `ok: false` and a write's `mutation.outcome` (`refused`, `verification_failed`, `outcome_unknown`) become the failed check's problem text, and a write's answer with an unpersisted audit (exit 2) is a failure too. Authored content, the pull request title and body, goes only in the data file. The operations are `resolve` (the repository behind the branch's git remote), `pr.view` (the open pull request by head branch), `pr.create`, `pr.draft` and `pr.ready` (the draft/ready state), `pr.edit-body`, `checks.state`, `checks.logs`, `pr.reviews` `pr.merge-state` and, when review waits are enabled, `pr.merge`. The one read left on `gh` is the pull request's review threads and conversation comments, a single GraphQL query. Scripts own pull request state and description. The finalize fixer uses `gh api` to reply to comments and resolve fixed threads; replies end with `<!-- codagent-reply -->`. Human comments count even from the pull request author; marked run replies do not. Unfixed top-level human comments remain actionable. Agents still push with `git`, and the tester may read the pull request's comments with `gh pr view --comments` when its judgment needs a fresh look.

The first node after `validate-inputs`, `check-forge`, runs `archon forge check` for the host of the branch's remote with exactly those operations, so a missing plugin or credential refuses the run before any agent spends. It makes no call to the forge itself.

The docs' Setup page says how users install the forge plugin.

The comments and threads read stays on `gh` because the forge's actor record has no account type, and GraphQL's `__typename` is what tells a bot from a person. It decides which comments are informational and which review threads a bot's reply defers.

## What a run writes

The checklist is `<change_dir>/checklist.md`, committed with the change. Agents and scripts share these files under the run's `$ARTIFACTS_DIR`:

| File | Written by | Purpose |
| --- | --- | --- |
| `implementation-blocked.md` | any implementor step | The question only a human can answer. Its existence fails the next check. |
| `decision-log.md`, `dispute-log.md` | agents and handoff scripts | Consequential decisions and unfixed disagreements. Numbered and committed in the change folder after acceptance; later entries go to those committed copies. Empty logs are valid. |
| `implementation-complete.md` | implementor | Completed work and the location of its verification evidence. |
| `completion-problems.txt`, `completion-check.json`, `completion-verdict.json`, `completion-loop.jsonl`, `completion-state.json` | completion scripts | Independent completion checks, retained judgments and bounded-loop counters. |
| `continue-snapshot.json`, `implementation-remaining.md`, `implementor-response.md` | completion scripts | Progress comparison and judge/implementor handoff. |
| `archive/state.json`, `archive/before.json`, `archive/specs-before.json`, `archive/local-specs.json` | archive scripts | Owned archive paths and preexisting changes used to verify the isolated commit. |
| `ci/finalize-<n>.md`, `ci/final.md`, accompanying JSON and `ci/latest.json` | finalize scripts | Per-cycle CI reports and final-head reuse state. |
| `step-results.json`, `finalize-results.json`, `acceptance-stop.txt` | finish scripts | Outcomes, blockers and work remaining. |
| `acceptance-commands/round-<n>/manifest.json` and output files | tester | Per-round command evidence. The review page shows validated excerpts of up to 20 lines and keeps full output in the run. |
| `review/evidence.json`, `review/media-problems.json` | package scripts | Accepted screenshots and commands available to the ranker, and any manifest errors. |
| `review/required.json`, `review/log-state.json` | package scripts | Independently inventoried minimum tiers and counts of run-log entries copied to the committed logs. |
| `review-attention.json`, `review-package.md` | package scripts | Checked red, orange and yellow ranking with labeled links and generated PR description block. |
| `review/human-checks.json` | ranking preparation | Human-only test IDs and titles extracted from the test plan. |
| `review-page-round-<n>.html`, `review-page.html` | publisher | Each numbered review page and the latest page. |
| `review/pages.json`, `review/outcome.json` | review scripts | Page index and terminal merge or close outcome. |
| `review-answers-round-<n>.json`, `review-response-round-<n>.json` | review scripts and implementor | Reviewer's saved answer and the implementor's response. |
| `acceptance-screenshots/round-<k>/`, `acceptance-journeys/round-<k>.json` | tester | Manifest-listed screenshots and the journeys exercised each acceptance round. |
| `review/accepted-head.txt`, `review/retested-commits.json`, `review/round-<n>/` | review scripts | Accepted revision, retested commits and prior round results. |
| `evidence/` | implementor | Saved output each checklist row's evidence names. |
| `planned-checklist.md`, `evidence-problems.txt` | scripts | The planned checklist, and the evidence check's problem list. |
| `nodes/audit.md` | Archon | The reviewer's inspection audit findings. |
| `session-report.md` | implementor | The implementor's session report, which the acceptance tester reads. |
| `exploration-log.md`, `acceptance-findings.md`, `acceptance-tested-revision.txt` | tester | Each round's exploration and findings, and the revision it tested. |
| `acceptance-round-status.txt`, `acceptance-handoff.md` | tester | The round's verdict, and the handoff for the human reviewer, written in full every round. |
| `acceptance-preparation-status.txt`, `acceptance-handoff-tester.md` | write-acceptance-status script | The final status. When acceptance did not converge, the script writes a short `acceptance-handoff.md` and keeps the tester's as `acceptance-handoff-tester.md`. |
| `acceptance-retest-reason.txt` | implementor | Why a fix that changed nothing still needs a retest. |
| `pr-title.txt` | open-draft-pr | The pull request title, used only when the pull request does not exist yet. |
| `pr-body.md` | open-draft-pr | The pull request description, without markers. The publish-draft-pr script adds the markers and puts it in the body. |
| `pull-request.json` | check-draft-pr script | The branch's open pull request as last checked: url, number, base, draft state and head revision. The tester compares its head with local HEAD. |
| `review/before-pr.md`, `review/acceptance.md`, `review/feedback.md` | review scripts | Latest results for before the draft (including tail) and the latest reviewed acceptance round: ranges, unresolved findings and accepted declines. |
| `review/state.json` | review scripts | All cycles, unique finding IDs, action history, handoffs and last reviewed revision. |
| `ci/round-<n>.md` | wait-ci script | Each round's CI result, failed-check logs and pull request comments. |

## Tests

Run these from this folder after `bun install`. None of them makes model calls or contacts a forge.

```sh
bun run test:fixtures   # the workflows' dry-run fixtures
bun test tests/         # the script tests
bun run lint            # Biome, jscpd and tsc
```

**Dry-run fixtures** are the workflow tests. Each workflow's `fixtures/*.stubs.yaml` is one case for `archon workflow test`: it stubs the agent nodes and the scripts that push or call the forge, states the outcome and the nodes the run must reach, and for a workflow that declares a verdict, the authored outcome (`fixture.authored`). A fixture with `exec-code: true` also runs the scripts it does not stub for real, in a scratch checkout; the others stub every script they reach. Archon looks for them in a `fixtures/` folder next to the workflow. Archon finds `.archon/` only at a git repository's root, so `tests/run-fixtures.ts` runs them from a committed copy of this folder with a throwaway Archon home. Set `ARCHON` to use an Archon other than the one on PATH, such as `bun <archon checkout>/packages/cli/src/cli.ts`.

Archon's dry run does not evaluate a loop's `until_bash`, so fixtures cannot reach a loop's exit, a second or third repair, the exhaustion of a repair loop, or acceptance round 2 and later. A loop's single simulated iteration is the one a fixture covers. The script tests cover the scripts' side of those paths.

**Script tests** run the `.shared/lib` modules against temporary git repositories (git 2.38 or later), with fake `archon`, `gh` and `openspec` commands (the fake `archon` prints forge envelopes; `openspec` output matches OpenSpec 1.17.0); a test that calls the real ones fails.

**Lint.** Biome fails on cognitive complexity over 10, functions over 50 lines, files over 300 lines (500 for tests), more than 4 parameters, and shadowed names, along with its recommended rules. jscpd fails on any repeated block of 50 tokens or more in the TypeScript or workflow YAML; fixtures are exempt. `tsc --noEmit` type-checks the scripts, `.shared/lib` and the tests against `tsconfig.json`. Fix the code rather than raising a limit or adding an ignore comment.

## Live trials

The tests above stub every agent. A live trial runs `codagent-implement-change` with real agents on [pacaplan/archon-live-trial](https://github.com/pacaplan/archon-live-trial), a public repository kept for this. It holds a tiny bun CLI and one OpenSpec change, `add-greeting-config`, which its `main` never implements. A trial is available for testing a pack change with real agents when that is worth its cost: it spends usage on every role's provider, takes 15 to 30 minutes, and opens a public draft pull request. Start one only when the user allows it.

```sh
bun run live-trial                               # start a trial of this checkout's pack
bun run live-trial --input acceptance_rounds=1   # with a workflow input
bun run live-trial cleanup <branch>              # close the trial's pull request and delete its branch
```

The script runs the pack as it is on disk in this checkout, edits included. It clones the repository to `~/.agent-workflows/live-trial/archon-live-trial` the first time and brings its `main` up to date, then starts the run detached on a new branch, `trial-<UTC time>`. It prints the run id and the commands to wait and to clean up. `--change`, `--branch` and `--from` pick another change, branch or start branch. To try a path the stock change does not reach, commit another change folder on a local branch of the clone and pass `--change <name> --from <that branch>`.

Before a trial, bind every role alias the pack uses in the Archon config, including any the change adds: an unbound alias falls back to its tier's default model without a warning. When the run stops, read `archon workflow get <run-id> --cwd <clone> --json --verbose` and the files the run wrote (see [What a run writes](#what-a-run-writes)), then clean up. Archon removes the trial's local worktree in its own `archon isolation cleanup`.

## Design doc

The pack's high-level design is a private claude.ai artifact: https://claude.ai/artifact/MjJSm1v3iftyrPdrV4ZVLj. Keep it up to date as the pack changes. When you define a change to the pack, update the doc during the define workflow, ideally at the proposal stage, and mark what the change adds until it merges. Don't update it while implementing a change, or list it as implementation work in a proposal: an implementation run, such as Archon's, can't open or republish a private claude.ai page. To update it, read it with the Artifact tool, edit that copy, and republish to the same URL. Don't make it more detailed: it should have all the important details, and everything in it should be accurate.
