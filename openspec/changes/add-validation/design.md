## Context

This change is for the Archon pack in `factory-workflows/archon/`. Workflow paths below are relative to `factory-workflows/archon/.archon/workflows/codagent/` unless they start with `factory-workflows/`.

Today `implement-change/implement-change.yaml` ends with an `include:` of `codagent-verify-change` (`verify-change/verify-change.yaml`). Verification checks the assumptions handoff, checks that the worktree is clean, opens the draft pull request and runs the acceptance rounds. Its agent steps run on `@lead` in fresh sessions. The definition repairs in `check-definition/` and `commit-definition/` also run on `@lead`. Nothing reviews the code for defects. The audit (`@crosscheck`) checks the code against the definition and the checklist only.

Archon facts this design relies on. The reference docs are in the pack's Archon checkout, `packages/docs-web/src/content/docs/reference/workflow-language.md` and `guides/loop-nodes.md`.

- `context: { resume: <id> }` names a command or prompt node in the same workflow, or an `include:` node, which means the included workflow's returned node. A node inside an included workflow cannot name a node of the workflow that includes it. A probe on the pack's Archon confirmed that such a workflow fails to load.
- A resume continues the named node's session, with the turns of every node that continued it and that the resuming node depends on, directly or through other nodes. Inside a `loop_group`, nodes of earlier iterations count. A skipped node adds nothing. When two such nodes could have run at the same time, the resume continues from the last point they share, so two nodes that run at the same time never share a session. A retry, or a node that `workflow resume` runs again, starts from the same point as the failed attempt and never sees its turns. On Codex the resume continues the thread in place when that point is the thread's last turn, and forks the thread at that point otherwise. On Claude it forks the session. This is the Codagent-AI fork's meaning of `context: resume`. Upstream Archon forks the named node's session and does not add the later turns.
- A resume never falls back to a fresh session. A missing source session fails the node, and so does naming a node that was skipped.
- A request reads the provider's prompt cache only as far as an earlier request on the same session had the same output schema and tools. On Codex the schema is part of the cached prompt, and on Claude it is the `StructuredOutput` tool. So a node whose `output_format` differs from the previous node's on its session misses the cache for the whole session.
- A resume's source and consumer must resolve to the same provider.
- `max_iterations` must be a literal.
- A `loop_group` inside a `loop_group` body is supported but is "not hardened in v1". This design does not use one.
- A dry run does not evaluate `until_bash`, so fixtures reach only a loop's first iteration.
- `output_type: findings` on the audit is only a label. Archon writes the node's text to `$ARTIFACTS_DIR/nodes/<id>.md`. `output_format` is a JSON schema that Archon enforces, and a failed validation fails the node.
- Node-level `mutates_checkout: false` fails the node when the worktree's status or dirty contents change. It does not notice a new commit on a clean worktree.

`factory-workflows/archon/PROVENANCE.md` records the workflows the pack was ported from. There, a validator reviewed the change after the assumptions handoff check and before the clean-worktree check, as a gate, and again after each acceptance fix, as a warning. This design puts the review at the same place, and it is never a gate.

## Goals / Non-Goals

**Goals:**

- Review the change's code for defects before the draft pull request opens, and review each acceptance fix before it is pushed.
- Let the implementor, in its own session, fix each finding or decline to fix it, with a bounded debate with the reviewer.
- Send every `high` or `medium` finding that was not fixed to `acceptance-assumptions.md`, including declines the reviewer accepted, and never fail a run because of findings.
- Make `review_strategy` the place where another reviewer plugs in later, without changing the fix rounds.
- Remove the `@lead` role.

**Non-Goals:**

- Running the project's tests, lint or build as a gate.
- Any strategy besides `builtin` and `none`.
- Showing the review's decisions in the pull request description, which has its own issue.
- The implementation completion loop, which has its own issue.
- Any change to Archon or to the define-openspec-change plugin.

## Approach

### One workflow

`verify-change/` is removed. Its nodes, commands, scripts and fixtures move into `implement-change/`. `implement-change.yaml` now runs, in order:

1. **Setup.** `validate-inputs`, `check-forge`, then the `check-definition` and `commit-definition` includes. Their repair nodes become `['@implementor', large]` with `context: fresh`, so their commands keep the autonomy preamble.
2. **Checklist and implementation.** `implementor-checklist`, the checklist checks, `implement` and the evidence checks, as today.
3. **Audit.** `audit` (`@crosscheck`), `resolve-findings`, `recheck-evidence` and their repairs, as today.
4. **Wrap-up.** `check-clean` (its repair resumes `resolve-findings`), `verify-implementation-commits`, then `session-report` (resumes `resolve-findings`), as today.
5. **Verification, now in the same workflow.**
   1. `verify-assumptions-handoff`. Its repair resumes `session-report`.
   2. The review before the pull request (below).
   3. `verify-clean-for-pr`. Its repair resumes `session-report`.
   4. The tail review (below). It runs only when the head moved since the last review.
   5. `open-draft-pr` (`@implementor`, `context: fresh`, no preamble), `publish-draft-pr`, `verify-draft-pr`, and `reopen-draft-pr` (resumes `open-draft-pr`).
   6. The `acceptance-rounds` loop. `acceptance-fix` becomes `@implementor` and resumes `session-report`, so it continues the implementor's session after the review fixes and any repair. Its push and pull request repairs become `@implementor`. Each round reviews its fix (below).

### The implementor's session

The implementor's session runs from `implementor-checklist` to the last acceptance repair: every `@implementor` node that resumes, through any chain, `implementor-checklist`. None of them can run at the same time as another, so they make one session that each node continues in place. Each names the node its prompt follows from, such as `session-report`, and gets the turns of the conditional nodes that ran since.

Every node on the session returns one schema, the `&implementor-result` anchor, defined on `implementor-checklist`:

```yaml
blocked: boolean
reason: string
actions: [{ id: string, action: fixed | declined | replied, note: string }]
```

A node returns the fields it does not use empty: a repair returns no actions, and `implement` returns `blocked: false` and no actions unless it stops. The schema must stay the same on every node, word for word, because any difference misses the cache.

Every `blocked` is read. The repairs' rechecks and `record-review-fixes` read it as before. `check-not-blocked`, after `implementor-checklist`, `implement` and `resolve-findings`, fails when the blocked record exists or the node returned `blocked: true`, and prints the record when there is one, or else the reason. `verify-assumptions-handoff` reads `session-report`'s, and `check-acceptance-progress` reads `acceptance-fix`'s, failing the run with `REPAIR_BLOCKED: <reason>` as a blocked repair does.
   7. `write-acceptance-status`. The workflow's `returns:` names it, with `outcome_field: ready`.

`implement-change/scripts/validate-inputs.ts` takes over what verification's `validate-inputs.ts` checked. It validates `acceptance_rounds` against the literal 10, which moves to the implement workflow as the `&max-rounds` anchor. It outputs `change_dir`, `artifact_validation_instruction`, `rounds`, and `review`, which is `true` unless `review_strategy` is `none`. Verification's `validate-inputs.ts`, `check-forge.ts` (a duplicate), and its `review-assumptions.md` and `simplify.md` commands are deleted.

The inputs `skip_implementation_review` and `stop_unchanged_acceptance` are removed. `checkProgress` in `.shared/lib/acceptance.ts` loses its option and always stops an acceptance fix that changed nothing and asked for no retest.

### The strategy setting

`.pack/pack.yaml` gains:

```yaml
review_strategy:
  type: enum
  values: [builtin, none]
  default: builtin
  description: >-
    builtin: the pack's reviewer reviews the change before the draft pull request
    and after each acceptance fix. none: no review runs.
```

Archon refuses an unknown enum value at launch, before any node runs, as it does for `change_kind`. The implement workflow passes the setting to `validate-inputs`.

Every review node runs with `when: "$validate-inputs.output.review == 'true'"`. A node after a review depends on both the review's last node and the node before the review, with `trigger_rule: none_failed_min_one_success`, so it runs whether the review ran or was skipped. A later strategy adds its own reviewer node, with a `when:` on the strategy, that writes the same output shape. The shared nodes stay keyed on `review`.

### The review before the pull request

All review commands and scripts take the review's place (`before-pr` or `acceptance`) as an input, so both places share them.

1. **`prepare-review`** (script). It reads the start revision, `$implementor-checklist.execution.checkoutStart`, and fails the run naming the reason when it is empty or not a commit. The range is start to `HEAD`, leaving out the change folder (`git diff <start>..HEAD -- . ':(exclude)<change_dir>'`). It starts the cycle in the state file and outputs `needed`, `start` and `end`. `needed` is `false` when the range has no changes and no finding is open.
2. **`review-change`** (`['@reviewer', medium]`, `context: fresh`, `mutates_checkout: false`, when `needed`). Its command starts with the autonomy preamble. Then come the three review prompts, inlined word for word in this order and joined with `\n\n---\n\n`: code quality, security, error handling. Their source is in the repository that item 2 of `factory-workflows/archon/PROVENANCE.md`'s removed steps names, at commit `24e6f3e`, files `src/built-in-reviews/code-quality.md`, `security.md` and `error-handling.md`. Then a task section gives the range, the excluded change folder, the rule to change no file, and the output shape. The prompts end with a "Reasoning Format" section. The task section says the JSON output replaces any format the prompts give.
3. **`record-review`** (script). It runs whether `review-change` ran or was skipped. It checks that `HEAD` still equals `end`, and fails the run naming the review when the reviewer moved it. It gives each finding the next ID (`R1`, `R2`…) and the state `open`, records `end` as the last reviewed revision, writes the result file, and outputs `settled`.
4. **`review-fixes`** (`loop_group`, `max_iterations: 3`, `on_exhausted: complete`, when `settled` is `false`). Its `until_bash` reads `$end-review-round.output.stop`. Its body:
   - **`fix-review-findings`** (`['@implementor', large]`, resumes `session-report`). It gets the findings that are not closed, from the state file. For each `open` finding it fixes and commits, or declines to fix it and says why. For each `contested` finding it replies, or fixes. Each fix commit follows the project's conventions with the `[review-fix]` prefix. It runs only the unit tests its fix affects, within 3 minutes, as the acceptance fix does. For each checklist row whose code changed, it reruns the row's check or marks the row `not verified`. It does not write its declines to `acceptance-assumptions.md`, because the workflow hands off what stays open.
   - **`record-review-fixes`** (script). It applies the fixer's actions to the state, records the new `HEAD` as the range's end, and outputs `blocked`, `start` and `end`.
   - **`re-review`** (`['@reviewer', medium]`, resumes `review-change`, `mutates_checkout: false`, skipped when `blocked`). It gives a verdict on each `fixed`, `declined` or `replied` finding, and reports new defects of any priority found only in `start..end`, without the change folder.
   - **`end-review-round`** (script, runs whether `re-review` ran or not). When the re-review ran, it applies the verdicts and new findings, checks that `HEAD` did not move, and records `end` as the last reviewed revision. When the fixer was blocked, the last reviewed revision stays where it was, because no review covered the fixer's commits. It rewrites the result file and outputs `stop`. `stop` is `true` when every finding is `closed` or `disputed`, or when the fixer was blocked.
5. **`hand-off-review`** (script, runs whether `review-fixes` ran or not). It appends to `acceptance-assumptions.md` each `high` or `medium` finding, from any cycle, that is not yet handed off and is either not closed or closed by an accepted decline or reply. It marks each one handed off. Taking every cycle means the next hand-off also takes what an interrupted cycle left. A `low` finding that is not closed stays in the result file only.

Within the loop, the fixer continues the implementor's session, and the re-review continues the reviewer's session from `review-change`. So the reviewer keeps one session for the cycle.

### Output shapes

`review-change`, the tail review, `re-review` and their acceptance-round forms share one schema, so a re-review that continues the reviewer's session reads its cache. A first review returns no verdicts:

```yaml
type: object
properties:
  verdicts:
    type: array
    items:
      type: object
      properties:
        id: { type: string }
        verdict: { type: string, enum: [confirmed, rejected, accepted, contested] }
        reason: { type: string }
      required: [id, verdict, reason]
      additionalProperties: false
  findings:
    type: array
    items:
      type: object
      properties:
        title: { type: string }
        file: { type: string }
        line: { type: integer }       # 0 when the finding has no line
        severity: { type: string, enum: [high, medium, low] }
        category: { type: string, enum: [quality, security, error-handling] }
        problem: { type: string }
        fix: { type: string }
      required: [title, file, line, severity, category, problem, fix]
      additionalProperties: false
required: [verdicts, findings]
additionalProperties: false
```

An empty `findings` list means the review found no defect. `line` is an integer with 0 for none, because every provider's strict mode accepts it.

`fix-review-findings` returns the implementor's schema (above), with its actions.

Both use `additionalProperties: false` and list every property as required, as the pack's other schemas do.

### Finding states

`review/state.json` holds every finding of the run. Each has its fields, the cycle it came from, `state`, a `contested` flag, a `handed_off` flag, and a history of every action with its round, actor and note. IDs are unique across the run. The file also holds each cycle's place, start and blocked reason, the last reviewed revision, the next ID, and the ignored actions. Each prepare step starts a new cycle, and the other scripts act on the current cycle's findings.

| State | Fixer may | Reviewer may |
| --- | --- | --- |
| `open` | `fixed` → `fixed`, `declined` → `declined` | nothing |
| `fixed` | nothing | `confirmed` → `closed`, `rejected` → `open` |
| `declined` | nothing | `accepted` → `closed`, `contested` → `contested`, or `disputed` if it was contested before |
| `contested` | `replied` → `replied`, `fixed` → `fixed` | nothing |
| `replied` | nothing | `accepted` → `closed`, `contested` → `disputed` |
| `closed`, `disputed` | nothing | nothing |

A finding that has been handed off takes no action. Any other action, or an unknown ID, is ignored and listed in the result with its reason, and the finding keeps its state. A finding the fixer did not act on keeps its state. A contest always reaches the fixer in the next round, if a round is left.

### Hand-off to the assumptions record

Each finding the hand-off takes becomes one `## ` section in `$ARTIFACTS_DIR/acceptance-assumptions.md`:

```markdown
## Review finding R2, before the pull request: <title>

- Question: Is this a defect that must be fixed before the change is accepted? <problem> (<file>:<line>, <severity> <category>)
- Requirement: the <category> review instructions.
- Ruling: <"Declined to fix:" with the fixer's reason and any reply, and "The reviewer accepted it." when it did, or "None: the finding was still open when the fix rounds stopped.">
- Rationale: <the history: the reviewer's finding and suggested fix, each decline, contest and reply in order, and the fixer's blocked reason if any>
- Pending decision: <whether to fix it before accepting the change, or for an accepted decline, "None, unless you disagree with the decline.">
```

An acceptance finding's heading names its round, such as `Review finding R1, acceptance round 2`. The script removes the line `No unresolved assumptions or context gaps.` when it adds a section. The existing handoff check only requires the file to exist and not be empty, so the order of the check and the hand-off does not matter to it.

### The tail review

After `verify-clean-for-pr` and its repair, `prepare-tail-review` (the `prepare-review` script in tail mode) compares `HEAD` with the last reviewed revision in `review/state.json`. When they are equal, nothing else in the tail runs. Otherwise it starts a tail cycle and outputs the new range. The range covers commits from a clean-worktree repair, and any commit a blocked fixer made before it stopped.

- **`tail-review`** (`['@reviewer', medium]`, `context: fresh`, `mutates_checkout: false`) uses the `review-change` command with the new range. The state file gives it the findings, so a fresh session loses little.
- **`record-tail-review`** (the `record-review` script in tail mode) records the new findings as `open`, moves the last reviewed revision to `HEAD`, rewrites `review/before-pr.md`, and hands the new `high` and `medium` findings off at once. There are no fix rounds.

`open-draft-pr` then runs, in a fresh session. It writes the pull request from the change folder and the branch's commits, so it does not need the implementor's long session. Its command says not to commit, so the pull request's head is the last reviewed revision. It also reads `review/before-pr.md`.

### The review in each acceptance round

In the round body, after `check-acceptance-progress` and only when its `push` is `true`, the round runs one cycle with a single fix round, as plain nodes with no nested loop: `prepare-round-review`, `round-review` (fresh, with the `review-change` command), `record-round-review`, `fix-round-findings` (resumes `acceptance-fix`, when the cycle is not settled), `record-round-fixes`, `round-re-review` (resumes `round-review`, skipped when the fixer is blocked), `end-round-review` and `hand-off-round-review`. They use the same commands and scripts as the cycle before the pull request. Then `acceptance-push` runs.

- The first review's range runs from the last reviewed revision in `review/state.json` to the working tree, leaving out the change folder (`git diff <last-reviewed> -- . ':(exclude)<change_dir>'`). So it also covers tracked changes the acceptance fix left uncommitted, which the progress check counts as progress. The push repair commits those changes without changing product contents, so what is pushed was reviewed. The re-review's range is the fixer's commits.
- With one fixer turn, a contest gets no reply in the round. A contested decline is handed off with the finding, the decline and the contest.
- `fix-round-findings` continues the implementor's session through `acceptance-fix`. `round-review` starts fresh in each round, and `round-re-review` continues that round's reviewer session.
- A blocked fixer's commits in an acceptance round are pushed without a review, because the round has no tail review. The next round's review starts from the last reviewed revision, so it covers them when that round has a fix.
- `acceptance-push` depends on `hand-off-round-review` and `check-acceptance-progress`, with `trigger_rule: none_failed_min_one_success` and its current `when:`.

### Later reviews and handed-off findings

The tail review and each round's first review get, from `review/state.json`, the title, file and line of each finding already handed off in the run. The `review-change` command lists them and says not to report one again unless the new changes make it worse. For the first review before the pull request the list is empty.

### Run files

Under `$ARTIFACTS_DIR/review/`:

- `before-pr.md` and `acceptance.md`: the place's result, rendered from the state file. `before-pr.md` covers the cycle before the pull request and the tail. `acceptance.md` covers the latest round's cycle and is rewritten in each round that reviews. Each names the revisions it covered, lists the open and disputed findings or says `No findings.`, lists each accepted decline with its reason, lists the ignored actions, and gives the fixer's blocked reason if any.
- `state.json`: the state the scripts share, for the whole run. Nothing in it is replaced.

`.shared/lib/artifacts.ts` gains the three paths. The README's files table lists them.

### Shared code

`.shared/lib/review.ts` holds the pure logic, so bun tests can cover the rounds a dry run cannot reach:

- reading, creating and writing the state file;
- adding findings with the next ID;
- applying fixer actions and reviewer verdicts by the table above, including contest-once and ignored actions;
- whether a cycle is settled;
- the text of the findings that are not closed, for the fixer's prompt;
- rendering the result file and the hand-off sections, and removing the nothing-unresolved line;
- the last reviewed revision, the current cycle's findings and the findings already handed off, as filters over the one state file.

The scripts under `implement-change/scripts/` (`prepare-review.ts`, `record-review.ts`, `record-review-fixes.ts`, `end-review-round.ts`, `hand-off-review.ts`) only read inputs, call git and this module, and write files. The commands are `review-change.md`, `fix-review-findings.md` and `re-review.md`. The tail review and each round's first review use `review-change.md`, with their own range.

### Evidence after review fixes

The evidence is not checked again after review fixes. The fixer reruns the check of each row its fix touched or marks it `not verified`. The acceptance tester and CI run after the pull request opens.

### Tests and fixtures

- `tests/review.test.ts` covers `.shared/lib/review.ts`, following the pack's one-test-file-per-module layout (`acceptance.test.ts`, `params.test.ts`). It runs in the existing bun test run.
- `tests/acceptance.test.ts` drops the option to `checkProgress`. `tests/params.test.ts` covers the merged input validation.
- Verification's fixtures move to `implement-change/fixtures/` with the implement steps stubbed. Fixtures that exercise the removed assumption review, simplification or flags are deleted.
- The `happy-path` fixture gains the review's stubs and shows a review with no findings. New fixtures cover a first fix round, a blocked fixer, review off, the tail review, and an acceptance round's review with its one fix round. As the pack's AGENTS.md requires, the fixtures check that each new fresh node's command starts with the preamble.
- `tests/review.test.ts` also runs the review scripts against a real temporary git repository. `test-plan.md` lists each integration obligation.

### Docs

- `factory-workflows/archon/README.md`: roles gain `@reviewer` (`medium`) and lose `@lead`; the binding example, which binds `@reviewer` to a different provider than `@implementor`; the files table; the layout without `verify-change/`; the new setting.
- `factory-workflows/archon/PROVENANCE.md`: verification is folded into one workflow; there is no lead; the review replaces the source's validator at the same place and is not a gate; the prompts' source commit and files; the debate; the removed steps and flags.
- `factory-workflows/archon/AGENTS.md`: the role example becomes `['@implementor', large]`.
- `.pack/pack.yaml`: the `acceptance_fix_scope` description says "the implementor" instead of "the lead".
- `implement-change/commands/session-report.md`: drops "and the assumption review", which no longer exists.

## Decisions

- **Fold verification into the implement workflow.** Archon lets a node resume only a node in its own workflow, or the returned node of a workflow it includes. The fixer must continue the implementor's session, so the steps after the session report must be in the implement workflow. The definition includes stay separate, because their repairs start fresh.
- **Review after the assumptions handoff check and before the clean-worktree check.** That is where the source reviewed the change. A repair of the clean check can still commit, which the tail review covers.
- **The implementor takes over the lead's steps.** In the pack the lead is a fresh session that knows nothing of the implementation. The acceptance fixes continue the implementor's session instead. The pull request step and the definition repairs run fresh, on `@implementor`.
- **One implementor session, continued in place.** Agent Runner ran the implementor as one session. Upstream Archon's `context: resume` forks, so each resumed node misses the provider's prompt cache on Codex and pays for the whole session again: about 684k input tokens in one evaluation run. The Codagent-AI fork continues the session in place, and forks only for a retry or for nodes that could run at the same time.
- **One schema on the implementor's session.** A schema change misses the cache, so the nodes share one schema, and a node returns the fields it does not use empty. Writing results to files instead would leave the dry-run fixtures unable to stub a blocked repair, since a stub supplies only a node's output. Parsing a result out of the reply is the invented protocol Archon's rules forbid.
- **One schema on the tester's session.** In each round `acceptance-handoff` continues `acceptance-test`'s session, so both return the `&tester-result` schema, `{ready, reason}`. For the test, `ready` means ready for CI and decides whether `wait-ci` runs. For the handoff, it means the round is ready, matching the status line it writes. Nothing reads the handoff's result: the gate still reads the status line and the evidence. A fresh handoff would also avoid the miss, since the tester writes its evidence to files, but it would lose what the tester knows and did not record.
- **The pull request step is fresh.** It only summarizes the change folder and the commits, so continuing the implementor's session would make it read the whole session to write a description.
- **The workflow owns IDs and states.** Agents report actions and verdicts by ID, and a script applies them by a fixed table. Agents cannot skip a state, reopen a closed finding, or contest twice, and bun tests can cover every transition.
- **A JSON `output_format` for every review output.** The audit's `output_type: findings` is only a label, so it cannot be the shared shape. A schema makes Archon reject malformed output, which fails the run naming the node, as the spec requires.
- **A decline can be contested once.** One contest and one reply give each side a turn. A finding that still has no agreement goes to a person with both sides.
- **Findings never fail the run.** The source gated the pull request on its review. Here a person reads the draft pull request anyway, and the assumptions record puts each unresolved finding in front of them.
- **The tail review has no fix rounds.** It covers small repairs made after the review. Fixing its findings would need another review of the fixes. Its findings go straight to the record.
- **The tail review is always fresh.** The state file gives the tail what it needs. One fresh node also needs no second form for a first review that skipped the reviewer.
- **One fix round in an acceptance round.** The fix is small, and the tester and CI check it again in the next round. One fixer turn and one re-review as plain nodes avoid a loop inside a loop, which Archon does not harden. The cost is no reply to a contest within a round, so the person gets both sides instead.
- **Accepted declines of `high` and `medium` findings go to the record.** Two agents agreeing not to fix a real defect is the one outcome nothing else checks. The pack already records in `acceptance-assumptions.md` each ruling a person might have made.
- **`low` findings stay in the result.** A `low` finding that is not closed is listed in the review result but is not a pending decision for the person. That keeps nits out of the record.
- **One state file for the run.** IDs stay unique across the run. The last reviewed revision, the current cycle and the handed-off findings are filters over one file. Files per place would need code to carry state from one to the next.
- **The prompts are copied word for word and inlined.** The reviewer then needs no file outside the pack. The JSON shape overrides the prompts' own format section, so they need no edits.
- **No evidence recheck after review fixes.** A recheck would add a repair path for small fixes. The fixer keeps the checklist honest, and the tester and CI follow.
- **Remove the two flags.** The implement run already set both to `true`. With verification folded in, nothing launches it another way.

## Risks / Trade-offs

- **The implementor's session grows long.** The fixer and the acceptance fixes continue it, which costs more per turn than a fresh session, though the cache covers most of it. A provider could also drop an old session; the node then fails rather than starting fresh.
- **The pack depends on the fork's meaning of `context: resume`.** On upstream Archon each resume would fork without the later nodes' turns, so the fixer and the acceptance fixes would not see the turns of the nodes that ran since the node they name. Nothing fails; they see less, and miss the cache.
- **A schema on every implementor node is unmeasured on long turns.** The repairs and fixers already do tool work under a schema. Whether a schema makes a long `implement` turn stop early is not known. An evaluation run should compare `implement`'s tool calls and duration with the baseline runs.
- **Dry runs do not evaluate `until_bash`.** Fixtures reach only the first fix round. `tests/review.test.ts` covers later rounds, contest-once and the end conditions.
- **A resumed run restarts an interrupted fix loop with three new rounds.** Archon keeps no iteration cursor for a failed `loop_group`. The state file keeps every finding and its state, so the restarted rounds go on from there, and the next hand-off takes what an interrupted cycle left. The cost is a few extra turns, and only after a failure and a resume. Persisting the round budget and cycle identity across resumes would add state and failure paths to every review node, for a rare case.
- **A later review can report a defect again that was already handed off.** Each later review gets the list of handed-off findings and is told not to repeat one. That depends on the model following the instruction. A duplicate only adds an entry to the record.
- **The lead's steps now run on the implementor's binding**, which may be another provider than a project bound to `@lead`.
- **A noisy review can cause churn.** The fixer may decline to fix, the rounds are bounded, and unsettled findings go to a person.

## Migration Plan

- A launch of `codagent-verify-change` fails after this change, because the workflow is gone. Launch `codagent-implement-change` instead.
- A project's `@lead` binding is no longer used and can be removed. A project should bind `@reviewer`, or it falls back to the `medium` tier.
- Review is on by default. A project that does not want it sets `review_strategy: none` under `settings:` in `.archon/packs/codagent.yaml`. That is also the quick rollback.
- At archive, the Purpose lines of `openspec/specs/acceptance-rounds/spec.md` and `openspec/specs/change-implementation/spec.md` still name `codagent-verify-change`. Update them to say the steps run in `codagent-implement-change`.
