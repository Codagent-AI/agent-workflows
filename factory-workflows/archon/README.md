# Codagent workflows for Archon

The `codagent` workflow pack for the [Archon](https://github.com/coleam00/Archon) engine. It takes an approved change definition, has agents implement it against a checklist of how each spec behavior is verified, audits the result, opens a draft pull request, and runs acceptance-test rounds until the change is ready for a human to accept.

This folder is the workflow source Archon reads: pass it to `--workflow-source`. `PROVENANCE.md` says where the workflows came from and how they differ from their source.

## Workflows

- `codagent-implement-change`, the entry point. It validates and commits the definition, has the implementor write a checklist, implement the change and record evidence, has the crosscheck audit the work and the implementor resolve the findings, checks that the work is committed and the worktree clean, saves the implementor's session report, and then runs `codagent-verify-change` with its own review steps turned off.
- `codagent-verify-change`. It reviews the implementation's assumptions and simplifies it (unless the caller already did), opens a draft pull request, and runs the acceptance rounds: an independent tester explores the change, the round waits for CI, the tester hands off, and a gate decides whether the change has converged. A round that has not converged gets a fix from the lead, a push, and a retest.
- `codagent-check-definition` and `codagent-commit-definition`, building blocks that `codagent-implement-change` includes.

## Layout

Paths are relative to this folder, `factory-workflows/archon/`.

```
.archon/workflows/codagent/          the codagent pack
  implement-change/                  codagent-implement-change: the workflow, commands/, scripts/, fixtures/
  verify-change/                     codagent-verify-change
  check-definition/                  codagent-check-definition
  commit-definition/                 codagent-commit-definition
  .shared/lib/                       TypeScript modules the scripts share
  .shared/implement-change.md        how the implementor works and tests
  .shared/verify-behavior.md         how the checklist is written and evidenced
tests/                               bun tests for .shared/lib, and run-fixtures.ts
tests/data/changes/                  sample change definitions the fixtures use
PROVENANCE.md                        where the workflows came from
package.json, biome.json, .jscpd.json  lint tools for development; the pack does not use them
```

Every check is a TypeScript script node run by bun. Agents read the two `.shared/*.md` documents through `$PACK_DIR`.

## Running

Requirements: Archon with `--workflow-source` and `$PACK_DIR`, the providers your role bindings name, logged in, `gh` authenticated with push access to the target repository, and the `openspec` CLI for an OpenSpec change (tested with OpenSpec 1.17.0).

```sh
archon workflow run codagent-implement-change \
  --cwd /path/to/target --no-worktree \
  --workflow-source /path/to/agent-workflows/factory-workflows/archon \
  --input change_name=<name> \
  --input change_dir=openspec/changes/<name> \
  --input change_label="OpenSpec change" \
  --input change_kind=openspec \
  --input artifact_validation_instruction="Run openspec validate <name>."
```

With `--no-worktree` the run works on the target checkout's current branch, which becomes the pull request's branch.

| Input | Default | Meaning |
| --- | --- | --- |
| `change_name` | required | Lowercase letters, digits and hyphens. |
| `change_dir` | required | The change's folder, relative to the checkout. |
| `change_label` | required | Human label for the change kind, such as `OpenSpec change`. |
| `change_kind` | required | `openspec` (also checked with `openspec validate`, and committed by the workflow) or `spec-driven` (whose definition must already be committed). |
| `artifact_validation_instruction` | required | One sentence telling agents how to validate a changed artifact. |
| `acceptance_rounds` | `3` | Most acceptance rounds, from 1 to 10. |
| `acceptance_fix_scope` | resolve every high-confidence finding | Which findings the lead resolves in each acceptance fix. |

`codagent-verify-change` run on its own takes the same inputs except `change_kind`, plus `skip_implementation_review` (default `false`; `true` skips the assumption review and simplification) and `stop_unchanged_acceptance` (default `false`; `true` ends the rounds when a fix changes nothing and asks for no retest). `codagent-implement-change` sets both to `true`.

### Roles

Each agent node names a role alias with a tier fallback: `['@implementor', large]`, `['@crosscheck', large]`, `['@lead', large]`, and `['@tester', medium]`. No node sets a provider, model or effort, so the binding decides all three. A run reads repository config from the launch checkout (`--cwd`), not from the workflow source, so bind the aliases in the target's `.archon/config.yaml`, in `~/.archon/config.yaml`, in a file passed with `--config`, or per alias with `--model '@tester=<provider>/<model>'`. An unbound alias falls back to its tier.

```yaml
aliases:
  '@lead': { provider: claude, model: <model>, effort: high }
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
| `evidence/` | implementor, lead | Saved output each checklist row's evidence names. |
| `planned-checklist.md`, `evidence-problems.txt` | scripts | The planned checklist, and the evidence check's problem list. |
| `nodes/audit.md`, `nodes/session-report.md` | Archon | The crosscheck's findings and the implementor's session report. |
| `exploration-log.md`, `acceptance-findings.md`, `acceptance-tested-revision.txt` | tester | Each round's exploration and findings, and the revision it tested. |
| `acceptance-round-status.txt`, `acceptance-handoff.md` | tester | The round's verdict, and the handoff for the human reviewer. |
| `acceptance-preparation-status.txt`, `acceptance-handoff-tester.md` | write-acceptance-status script | The final status. When acceptance did not converge, the script writes a short `acceptance-handoff.md` and keeps the tester's as `acceptance-handoff-tester.md`. |
| `acceptance-retest-reason.txt` | lead | Why a fix that changed nothing still needs a retest. |
| `pr-body.md` | open-draft-pr | The pull request description, without markers. The update-pr-body script adds the markers and puts it in the body. |
| `ci/round-<n>.md` | wait-ci script | Each round's CI result, failed-check logs and pull request comments. |

### Checks, repairs and limits

A failed check goes to one agent repair, then the same check runs again in strict mode and fails the run if the problem remains. A repair that cannot proceed without a human returns `blocked`, and the run fails with `REPAIR_BLOCKED: <reason>`. The evidence checks allow two repairs, and the definition check three.

`acceptance_rounds` is at most 10, because a loop's iteration ceiling must be a literal; the inputs check rejects a larger value. Each round waits up to 15 minutes for CI on the pull request's current head.

## Tests

Run these from this folder after `bun install`. None of them makes model calls or contacts GitHub.

```sh
bun run test:fixtures   # the workflows' dry-run fixtures
bun test tests/         # the script tests
bun run lint            # Biome and jscpd
```

**Dry-run fixtures** are the workflow tests. Each workflow's `fixtures/*.stubs.yaml` is one case for `archon workflow test`: it stubs the agent, git-push and GitHub nodes, runs the other scripts for real, and states the outcome and the nodes the run must reach. Archon looks for them in a `fixtures/` folder next to the workflow. Archon finds `.archon/` only at a git repository's root, so `tests/run-fixtures.ts` runs them from a committed copy of this folder with a throwaway Archon home. Set `ARCHON` to use an Archon other than the one on PATH, such as `bun <archon checkout>/packages/cli/src/cli.ts`.

Archon's dry run does not evaluate a loop's `until_bash`, so fixtures cannot reach a loop's exit, a second or third repair, the exhaustion of a repair loop, or acceptance round 2 and later. The script tests cover the scripts' side of those paths.

**Script tests** run the `.shared/lib` modules against temporary git repositories (git 2.38 or later), with fake `gh` and `openspec` commands (their output matches OpenSpec 1.17.0); a test that calls the real ones fails.

**Lint.** Biome fails on cognitive complexity over 10, functions over 50 lines, files over 300 lines (500 for tests), more than 4 parameters, and shadowed names, along with its recommended rules. jscpd fails on any repeated block of 50 tokens or more in the TypeScript or workflow YAML; fixtures are exempt. Fix the code rather than raising a limit or adding an ignore comment.
