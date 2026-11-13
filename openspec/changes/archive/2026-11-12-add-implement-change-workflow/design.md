# Design

## Context

The pack is a set of Archon workflows plus TypeScript script nodes. `codagent-implement-change` includes `codagent-check-definition` and `codagent-commit-definition`, and then `codagent-verify-change`. See proposal.md for why the pack exists and the specs for the required behavior. The pack records its provenance in `PROVENANCE.md`.

Constraints that shape the design:

- Archon dry runs do not evaluate a loop's `until_bash`, so fixtures reach only a loop's first simulated iteration.
- An included block takes nothing from its pack, so its caller must pass each setting.
- A loop's iteration ceiling must be a literal.
- The pack must not name a provider, model or effort. The launch checkout binds role aliases.
- A `context: fresh` node has no memory of earlier nodes, so its prompt must stand alone.

## Goals / Non-Goals

**Goals:**

- Every check is deterministic code. An agent decides only what code cannot.
- A failed check reaches an agent at most once, and then fails the run.
- Each acceptance round judges only evidence written in that round.
- A run that did not converge still ends with a handoff for a human.

**Non-Goals:**

- No planning step. The pack takes an approved definition; it does not write one.
- No merge of the pull request, and no marking it ready for review.
- No sandbox. Agents run on the host.
- No manual or human-only tests. The checklist may not cite them.

## Decisions

### Checks are script nodes with a shared repair pattern

Each check is a bun script that prints `{ok, problems}`. The same script runs again after a repair, with `strict`, `blocked` and `reason` bound. A strict failure fails the node, and a blocked repair fails it with `REPAIR_BLOCKED: <reason>`.

Why: the workflow can route a first failure to an agent and still fail hard on the second. A bun test checks that every check node binds all three inputs, because the loader does not follow imports and would not catch a misspelt binding.

Alternative: let the agent declare success. Rejected: the check that runs after the repair decides.

### One implementor session owns the checklist, the code and the fixes

The checklist, implement, resolve-findings and session-report steps resume one another's sessions. A repair resumes a fork of the role's session, so the role's main line continues from before the repair.

Why: the implementor that planned the checks is the one that fills them in, and later steps need its context. The fork trades that for a clean main line.

Alternative: a new session per step. Rejected: it would lose the reasoning behind the plan.

### The plan is saved, and only an audit finding can change it

`verify-checklist` copies the committed checklist to `planned-checklist.md`. The evidence check compares planned columns row by row. After the audit it lets a row change only if a finding names its ID.

Why: without this the implementor could rewrite a check it cannot pass. The check proves the checklist is complete, not true; the crosscheck judges whether the evidence proves each row.

### The crosscheck is a separate role and does not run anything

The audit uses a different role alias from the implementor and is inspection only.

Why: a second agent, possibly bound to another provider, reads evidence the implementor wrote. Running code would blur audit and testing, which the tester does later.

### Verification is a block the implement workflow includes

`codagent-verify-change` can run alone or inside `codagent-implement-change`. The caller passes `skip_implementation_review` and `stop_unchanged_acceptance`; they describe how the caller composed the workflow, so they are inputs, not settings.

Why: the implementor already did a maintainability pass and a session report, so review and simplify would repeat that. The assumptions ledger check still runs either way, because the human handoff relies on it.

### The pack, not an agent, writes to the pull request

The lead pushes with `git` and writes `pr-title.txt` and `pr-body.md`. Script nodes call `archon forge` to open the draft, splice the body between markers, convert it back to draft after pushes, and read checks, logs and reviews.

Why: a forge refusal or an unverified write becomes a failed check with the outcome in its text. An agent could not be trusted to keep the draft state or to leave a human's edits alone. Authored text goes in a data file, never in argv.

Alternative: agents run `gh`. Rejected for those reasons.

### Review comments stay on `gh`

One GraphQL query reads threads and conversation comments.

Why: the forge's actor record has no account type, and a bot test needs `__typename`. The bot test decides which comments are informational and which threads a bot's reply defers.

### CI wait is a script node between two tester turns

`acceptance-test` explores and says whether CI is worth waiting for. The `wait-ci` node polls, and `acceptance-handoff` resumes the tester to judge the report and write the handoff.

Why: a bounded script is cheaper and more predictable than an agent polling in a loop. The tester still judges what a comment means.

### The tester starts fresh each round

Archon continues a session across loop iterations only from an owner node that ran before the loop, and the tester has none. The exploration log, tested revision and findings carry context forward.

### The gate is tied to one commit

Ready means the status line, the tested revision and local `HEAD` all name the same commit, with evidence present and no tracked change. Ready on an older commit does not count.

Why: a fix after the tester's pass would otherwise leave an untested head marked ready.

### The rounds end at the gate, and the loop completes when exhausted

The last round never runs a fix, so no fix goes untested. The acceptance loop uses `on_exhausted: complete`, while the repair loops use `fail`. `write-acceptance-status` then records `ACCEPTANCE_FAILED` and the run's authored outcome is failed.

Why: a non-converged run must still deliver its handoff to a human.

### Where a node started comes from Archon

The checklist and commit checks read `$node.execution.checkoutStart` instead of recording the head and status in nodes of their own.

### Settings reach included blocks through `with:`

The including workflow binds each setting to each block's input. A per-run `--input` override reaches the blocks the same way.

### Checks are tested without model calls

Each workflow has dry-run fixtures that stub the agent nodes and the scripts that push or call the forge. The shared modules have bun tests that use temporary git repositories and fake `archon`, `gh` and `openspec` commands. This is a repo rule in AGENTS.md, so the specs do not state it.

### Behavior kept from the source workflow

These match the workflow the pack was ported from (see `PROVENANCE.md`):

- `check-implementor-checklist` fails the run, with no repair, when the checklist step commits or changes another file. The checklist must exist before any code. It is the first agent step, so the failure costs little.
- `check-clean` after the audit counts only tracked changes. An untracked file the implementor leaves behind is caught by `verify-clean-for-pr`, which repairs it before the pull request opens.
- A change inside a symlinked `openspec` folder is not committed, and the step passes with a message to commit it by hand.
- A change named like `abc-123-...` gets the commit message `ABC-123: Add change plan`.

### A spec-driven definition arrives committed

`codagent-commit-definition` passes a `spec-driven` change without committing it. The step that wrote the definition is expected to have committed it before the pack runs.

## Risks / Trade-offs

- [Fixtures cannot reach a loop's exit, a second repair, or acceptance round 2 and later] → bun tests cover the scripts' side of those paths. The workflow wiring on those paths is untested.
- [The CI wait polls the full 15 minutes when no checks exist, then reports passed] → it costs 15 minutes a round on a repository without CI. Tracked as a bug in this repository.
- [A tester that changes effort mid-session can end its turn after planning on some Archon releases] → the README tells the operator to keep effort equal to the provider's own config.
- [The acceptance ceiling is a literal 10, duplicated in two workflows] → a bun test checks they agree.
- [A repair forks the role's session] → later steps do not see the repair's reasoning, only its commits.
- [Agents run on the host] → no sandbox; the operator must trust the target checkout.
- [`openspec` changes must live in `openspec/changes`] → a project that keeps changes elsewhere must use the `spec-driven` kind.

## Open Questions

- The wait's 15 minutes and 30-second interval, the draft check's attempts, and the 100-line log tail are literals in the workflow or code. Should any of them be a pack setting?
