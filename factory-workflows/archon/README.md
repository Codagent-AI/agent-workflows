# Codagent workflows for Archon

The `codagent` workflow pack for the [Archon](https://github.com/coleam00/Archon) engine. It takes an approved change definition, has agents implement it against a checklist of how each spec behavior is verified, audits the result, opens a draft pull request, and runs acceptance-test rounds until the change is ready for a human to accept.

This folder is the workflow source Archon reads: pass it to `--workflow-source`. `PROVENANCE.md` says where the workflows came from and how they differ from their source.

## Workflows

- `codagent-implement-change`, the entry point. It validates and commits the definition, implements against a checklist, audits the work, checks assumptions, reviews the code, checks the worktree, opens a draft pull request and runs acceptance rounds. The implementor fixes review findings in its own session and handles acceptance fixes; the independent tester and CI check each round.
- `codagent-check-definition` and `codagent-commit-definition`, building blocks that `codagent-implement-change` includes.

The implementor's steps, from its checklist to the acceptance fixes, continue one session, so each reads the provider's prompt cache instead of paying for the session again. That needs the Codagent-AI Archon fork, where `context: { resume: <node> }` continues a session in place; upstream Archon forks it. Those steps share one output schema, because a step whose schema differs from the step before it misses the cache. The pull request description is written in a fresh session.

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

## Running

Requirements: Archon with `--workflow-source` and `$PACK_DIR`, the providers your role bindings name, logged in, `git` with push access to the target repository, the Archon forge plugin for its host (see [The forge](#the-forge)), and the `openspec` CLI for an OpenSpec change (tested with OpenSpec 1.17.0).

```sh
archon workflow run codagent-implement-change \
  --cwd /path/to/target --no-worktree \
  --workflow-source /path/to/agent-workflows/factory-workflows/archon \
  --input change_name=<name>
```

With `--no-worktree` the run works on the target checkout's current branch, which becomes the pull request's branch.

`change_name` is the only input a launch must give. Everything else is a pack setting, declared in `.archon/workflows/codagent/.pack/pack.yaml`, with defaults for an OpenSpec repository. The change's folder is derived: `<changes_root>/<change_name>`, which is `openspec/changes/<name>` by default.

| Setting | Default | Meaning |
| --- | --- | --- |
| `change_kind` | `openspec` | `openspec` (also checked with `openspec validate`, and committed by the workflow) or `spec-driven` (whose definition must already be committed). |
| `changes_root` | `openspec/changes` | The folder that holds the changes. An `openspec` change must use the default. |
| `change_label` | `OpenSpec change` | Human label for the change kind, used in the agents' prompts. |
| `artifact_validation_instruction` | empty | One sentence telling agents how to validate a changed artifact. Empty means the `openspec validate` sentence naming the change for `openspec`; a `spec-driven` change must set it. |
| `review_strategy` | `builtin` | `builtin` reviews before the draft and after each acceptance fix; `none` disables all review. |
| `acceptance_rounds` | `3` | Most acceptance rounds, from 1 to 10. |
| `acceptance_fix_scope` | resolve every high-confidence finding | Which findings the implementor resolves in each acceptance fix. |

A project that is not the default sets its values in `.archon/packs/codagent.yaml` in the target checkout, under `settings:` only:

```yaml
settings:
  change_kind: spec-driven
  changes_root: specs/changes
  change_label: spec-driven change
  artifact_validation_instruction: Validate a changed spec with the spec linter.
```

Archon reads this file from the run's own checkout, so an isolated run (a worktree) sees it only if it is committed or listed under `worktree.copyFiles`. `--input <setting>=<value>` overrides a setting for one run; the override reaches the blocks the run includes, because the workflow passes each setting on to them. An unknown key, or a value of the wrong type (`change_kind` must be `openspec` or `spec-driven`), refuses the run before any node runs.

Review is on by default and adds agent time and cost. Set `review_strategy: none` in project settings or with `--input` to disable it. Unknown `review_strategy` values are refused before any node runs.

### The forge

Scripts reach the pull request through `archon forge <op> --data-file <file>`, run from the exec layer with the argv Archon publishes in `ARCHON_CLI_COMMAND`. They parse the JSON envelope: `ok: false` and a write's `mutation.outcome` (`refused`, `verification_failed`, `outcome_unknown`) become the failed check's problem text, and a write's answer with an unpersisted audit (exit 2) is a failure too. Authored content, the pull request title and body, goes only in the data file. The operations are `resolve` (the repository behind the branch's git remote), `pr.view` (the open pull request by head branch), `pr.create` and `pr.draft` (the draft state), `pr.edit-body`, `checks.state`, `checks.logs`, `pr.reviews` and `pr.merge-state`. The one read left on `gh` is the pull request's review threads and conversation comments, a single GraphQL query. No script writes with `gh`, and no agent prompt tells an agent to write to the pull request. Agents still push with `git`, and the tester may read the pull request's comments with `gh pr view --comments` when its judgment needs a fresh look.

The first node after `validate-inputs`, `check-forge`, runs `archon forge check` for the host of the branch's remote with exactly those operations, so a missing plugin or credential refuses the run before any agent spends. It makes no call to the forge itself.

- From a source checkout of Archon (and in Docker) the GitHub forge plugin runs from source with the `gh` login, as a source checkout runs its providers. Nothing to install.
- With a release binary, install it once: `archon plugin add coleam00/Archon/plugins/forge-github`. The credential is `GH_TOKEN` or the `gh` login.

The comments and threads read stays on `gh` because the forge's actor record has no account type, and GraphQL's `__typename` is what tells a bot from a person. It decides which comments are informational and which review threads a bot's reply defers.

### Roles

Each agent node names a role alias with a tier fallback: `['@implementor', large]`, `['@crosscheck', large]`, `['@tester', medium]`, and `['@reviewer', medium]`. No node sets a provider, model or effort, so the binding decides all three. A run reads repository config from the launch checkout (`--cwd`), not from the workflow source, so bind the aliases in the target's `.archon/config.yaml`, in `~/.archon/config.yaml`, in a file passed with `--config`, or per alias with `--model '@tester=<provider>/<model>'`. An unbound alias falls back to its tier.

```yaml
aliases:
  '@reviewer': { provider: claude, model: <model>, effort: high }
  '@crosscheck': { provider: codex, model: <model>, effort: high }
  '@implementor': { provider: codex, model: <model>, effort: medium }
  '@tester': { provider: codex, model: <model>, effort: medium }
```

Archon releases that do not start a Codex thread at its node's reasoning effort start it at the effort in `~/.codex/config.toml` and change effort on the first turn. A Codex tester that changes effort mid-session can end its turn right after planning, so on such a release keep the Codex roles' effort equal to `~/.codex/config.toml`.

### What a run writes

The checklist is `<change_dir>/checklist.md`, committed with the change. Agents and scripts share these files under the run's `$ARTIFACTS_DIR`:

| File | Written by | Purpose |
| --- | --- | --- |
| `implementation-blocked.md` | any implementor step | The question only a human can answer. Its existence fails the next check. |
| `acceptance-assumptions.md` | every agent | Rulings an agent made on questions a human might have decided. |
| `implementor-decisions.md` | implementor | Ordinary decisions that could change behavior, scope or integration. |
| `evidence/` | implementor | Saved output each checklist row's evidence names. |
| `planned-checklist.md`, `evidence-problems.txt` | scripts | The planned checklist, and the evidence check's problem list. |
| `nodes/audit.md` | Archon | The crosscheck's findings. |
| `session-report.md` | implementor | The implementor's session report, which the acceptance tester reads. |
| `exploration-log.md`, `acceptance-findings.md`, `acceptance-tested-revision.txt` | tester | Each round's exploration and findings, and the revision it tested. |
| `acceptance-round-status.txt`, `acceptance-handoff.md` | tester | The round's verdict, and the handoff for the human reviewer. |
| `acceptance-preparation-status.txt`, `acceptance-handoff-tester.md` | write-acceptance-status script | The final status. When acceptance did not converge, the script writes a short `acceptance-handoff.md` and keeps the tester's as `acceptance-handoff-tester.md`. |
| `acceptance-retest-reason.txt` | implementor | Why a fix that changed nothing still needs a retest. |
| `pr-title.txt` | open-draft-pr | The pull request title, used only when the pull request does not exist yet. |
| `pr-body.md` | open-draft-pr | The pull request description, without markers. The publish-draft-pr script adds the markers and puts it in the body. |
| `pull-request.json` | check-draft-pr script | The branch's open pull request as last checked: url, number, base, draft state and head revision. The tester compares its head with local HEAD. |
| `review/before-pr.md`, `review/acceptance.md` | review scripts | Latest results for before the draft (including tail) and the latest reviewed acceptance round: ranges, unresolved findings and accepted declines. |
| `review/state.json` | review scripts | All cycles, unique finding IDs, action history, handoffs and last reviewed revision. |
| `ci/round-<n>.md` | wait-ci script | Each round's CI result, failed-check logs and pull request comments. |

### Checks, repairs and limits

A failed check goes to one agent repair, then the same check runs again in strict mode and fails the run if the problem remains. A repair that cannot proceed without a human returns `blocked`, and the run fails with `REPAIR_BLOCKED: <reason>`. The evidence checks allow two repairs and the definition check three, each repair followed by a recheck in a loop that fails the run when its repairs run out.

`acceptance_rounds` is at most 10, because a loop's iteration ceiling must be a literal; the inputs check rejects a larger value. Each round waits up to 15 minutes for CI on the pull request's current head. An acceptance fix that changes nothing and writes no retest reason ends the rounds.

### Code review

The builtin reviewer inspects changed code for quality, security and error-handling defects, excluding the change definition. It does not repeat the definition audit or review style. It starts fresh per cycle and keeps its session for re-reviews. Before the draft, up to three fixer/re-review rounds run. Each continuing acceptance fix gets one round before push. The implementor may commit a fix, decline with a reason, or reply to a contest. The reviewer confirms/rejects fixes and accepts/contests declines. A second disagreement becomes disputed.

Findings never gate the run. Unfixed high/medium findings and accepted high/medium declines go to `acceptance-assumptions.md` with both sides; low findings remain in review results. A review that cannot produce valid structured output fails the run. A commit after the initial cycle receives a fresh tail review without fix rounds before the draft opens at the reviewed head. Review fixes rerun affected checklist checks or mark them not verified; no extra evidence gate follows them.

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
