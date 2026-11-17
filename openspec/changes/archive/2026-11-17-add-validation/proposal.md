## Why

This change is for the Archon pack in `factory-workflows/archon/`.

The pack has no step that reviews the implemented code for defects. The crosscheck audit checks the code against the definition and the checklist evidence, by inspection only, and it does not review code quality. Nothing reviews the diff for bugs, security problems, or missing error handling before a person sees the pull request. Recent evaluation runs of the pack lost engineering-quality points, which is what such a review targets.

The workflows the pack was ported from reviewed the change at two points: before the draft pull request opened, as a gate, and after the fix in each acceptance round, as a warning. The port left that out. The pack records its provenance, and this difference, in `factory-workflows/archon/PROVENANCE.md`.

A review's findings are best fixed by the implementor, which knows the code. Two things in the pack stop that today:

- Verification is a separate workflow, `codagent-verify-change`, that `codagent-implement-change` includes. Archon lets a node resume a session only from its own workflow, so no step in verification can continue the implementor's session.
- The `@lead` role no longer does what it did in the source. There, the lead was the session that defined the change, and it answered the other agents' questions. In the pack, no agent defines the change, and agents rule on questions themselves. The lead's nodes are fresh sessions that open the pull request and make the acceptance fixes without knowing the implementation.

## What Changes

- **Add a code review**, chosen by a new pack setting, `review_strategy`. A strategy is a named way to review the change, and every strategy returns findings in the same shape, so the steps that fix findings do not depend on which strategy ran. This change ships two values:
  - `builtin`, the default: the pack's own reviewer agent, on its own role. Its instructions are three review prompts copied word for word from the source that `PROVENANCE.md` records: code quality, security, and error handling. It reviews only the changed code. It does not repeat the audit's check against the definition, and it does not review style. It only inspects, and it returns a findings list.
  - `none`: no review runs.

  Like the other settings, a project overrides it in `.archon/packs/codagent.yaml`, and a run overrides it with `--input`. An unknown value refuses the run at launch.
- **One workflow.** `codagent-verify-change` is folded into `codagent-implement-change`. The steps after the session report run in the same workflow as the implementor: the assumptions handoff check, the review, the clean-worktree check, the draft pull request, and the acceptance rounds. `codagent-check-definition` and `codagent-commit-definition` stay included workflows, because their repairs start fresh.
  - **BREAKING:** `codagent-verify-change` can no longer be launched on its own.
  - Its assumption review and simplification are removed. They ran only when it was launched on its own.
  - Its `skip_implementation_review` and `stop_unchanged_acceptance` inputs are removed. An acceptance fix that changes nothing and asks for no retest always ends the rounds, as it already did in an implement run.
- **No lead.** The `@lead` role is removed, and the implementor takes over its steps:
  - the definition repairs, which start fresh sessions;
  - the assumptions-handoff and clean-worktree repairs before the pull request, and the draft pull request, which continue the implementor's session from its session report;
  - the acceptance fixes, which continue from the pull request step, and their push and pull request repairs.
- **Before the draft pull request.** After the session report and the assumptions handoff check, and before the clean-worktree check, the review covers the whole change, from where the implementor started. Up to three fix rounds follow. High and medium findings that are not fixed go to the assumptions record for the person who reviews the draft pull request, and the run continues.
- **A review counts only for the code it covered.** The draft pull request opens only after a review covered its exact head. A later commit before the pull request, such as one from a clean-worktree repair, is reviewed first.
- **In each acceptance round.** After the implementor's fix and before the push, the round reviews the fix, with one fix round. High and medium findings that are not fixed go to the assumptions record, and the round continues to the push.
- **Fix rounds.** Each round is one fixer turn followed by one re-review.
  - The implementor, in its own session, fixes each open finding, declines to fix it and says why, or replies to a contested decline.
  - The reviewer confirms or rejects each fix, and accepts each decline or contests it once. It looks for new defects only in what changed since its last review. A finding closes when the reviewer confirms the fix or accepts the decline.
  - A finding is disputed when the reviewer still disagrees after the implementor's reply. Disputed findings go to the assumptions record with both sides. So do declines the reviewer accepted, so a person can see each defect the two agents agreed not to fix. Low findings that stay open are listed only in the review's result.
  - The reviewer keeps its session through one cycle: one cycle before the pull request, and one in each acceptance round. The review of a later commit before the pull request starts fresh.
- Save each review's result under the run's artifacts folder.
- Move verification's nodes, commands, scripts and fixtures into `codagent-implement-change`. Add dry-run fixtures for the new branches and bun tests for any new shared module. Update `factory-workflows/archon/README.md`, `PROVENANCE.md` and `AGENTS.md`.

Review is on by default. An existing launch with no settings now gets a review before its pull request opens, which adds cost and time.

## Capabilities

### New Capabilities

- `change-review`: what a review does. It covers the strategy setting's values, the `builtin` reviewer, what each review covers, the fix rounds and the debate in them, the results it saves, the rule that a review counts only for the head it covered, and how findings that are not closed reach the assumptions record without failing the run.

### Modified Capabilities

- `acceptance-rounds`: the rounds run in the implement workflow, the implementor makes and repairs the fixes, each fix is reviewed before it is pushed, an unchanged fix always ends the rounds, and the assumption review and simplification are removed.
- `change-implementation`: the change is reviewed after the assumptions handoff check, the implementor repairs the definition, verification is no longer a separate workflow, and the pull request and acceptance fixes continue the implementor's session.
- `draft-pull-request`: the implementor writes and repairs the pull request.
- `pack-settings-and-run-files`: the new setting and its validation, the removed inputs, the roles, the end of the review's fix loop, and the review result files.

## Technical Approach

The review follows the pack's existing patterns. The `builtin` reviewer is an agent node on a new `@reviewer` role with a `medium` fallback. It never names a provider or model: a project binds `@reviewer` like the other roles, and the README's example binding gains it and loses `@lead`. Each cycle's first review starts fresh with the autonomy preamble, and its re-reviews resume it. It returns its findings as JSON, which Archon checks against a schema. The fix rounds are a loop whose ceiling, three, is a literal, as Archon requires. The fixer resumes the implementor's session. A script records the revision each review covered, so the next review starts there and the check before the pull request can compare it with the head.

Folding verification into the implement workflow is what lets the implementor fix. Archon accepts a resume only of a node in the same workflow, or of the last node of a workflow it includes, never the other way. A probe on the pack's Archon confirmed that a node inside an included workflow cannot name a node of the workflow that includes it: the workflow fails to load.

The strategy setting is the place where another reviewer plugs in later, such as an external validator or a remote reviewer that works on the pull request. Each strategy's nodes run only when the setting names it, and each writes the shared findings shape, so adding one does not change the fix rounds or the two review points.

Decisions left to `design.md`:

- **The exact findings shape** that every strategy writes, with each finding's state, and how fixes, declines, contests and replies are recorded.
- **Whether the checklist evidence is checked again** after review fixes change code.
- **How a commit after the review is reviewed** before the pull request, and its fix budget.
- **The session wiring Archon allows,** such as the fix round inside the acceptance loop, and which nodes the fixer and later steps resume.
- **The names of the review result files.**

Risks:

- **A noisy review can cause churn,** or over-broad hardening that breaks working code. The fixer may decline to fix a finding, and the rounds are bounded, so a debate that does not settle goes to a person.
- **The implementor judges findings on its own code** and may decline to fix one too readily. The reviewer's contest and the assumptions record keep each such decline visible.
- **Each run costs more and takes longer.** Before the pull request there is one full review and up to three re-reviews, and each acceptance round adds a small review and one re-review. The pull request step and the acceptance fixes now resume the implementor's long session, which costs more per turn than a fresh one. Evaluation runs measure this against the pack's current results. The judge and engineering-quality points should hold or rise, at a modest cost increase.
- **The lead's steps now run on the implementor's binding,** which may be another provider and model than a project bound to `@lead`.
- **A review of only the latest changes can miss how a fix interacts with code reviewed earlier.** Fixes are small, and the acceptance tester and CI run afterward.
- **Archon's dry run does not evaluate a loop's exit,** so fixtures reach only the first fix round. Bun tests cover the scripts' side of later rounds, as they do for the existing repair loops.

## Out of Scope

- Running the project's checks, such as tests, lint and build, as a gate. The implementor runs them, and CI runs on the draft pull request in every acceptance round.
- Any review strategy other than `builtin` and `none`, such as an external validator or a remote reviewer.
- The steps after the draft pull request: human verification, archive and finalize.
- The implementation completion loop, which has its own issue.
- Showing the review's decisions and disputes in the pull request description, which has its own issue.
- Any change to Archon, such as letting an included workflow resume its includer's session.
- Any change to the define-openspec-change plugin.
- Measuring the review in evaluation runs, which is done outside this repository.

## Impact

- Changes under `factory-workflows/archon/.archon/workflows/codagent/`:
  - `implement-change/` gets verification's nodes, commands, scripts and fixtures, and the review's.
  - `verify-change/` is removed.
  - `check-definition/` and `commit-definition/` move their repairs to `@implementor`.
  - `.pack/pack.yaml` gets the setting.
  - `.shared/lib/` gets the code shared with input validation.
- Tests under `factory-workflows/archon/tests/`.
- `factory-workflows/archon/README.md`, `PROVENANCE.md` and `AGENTS.md`.
- Runtime needs: nothing new.
- A launch of `codagent-verify-change` fails, because the workflow no longer exists. A project's `@lead` binding goes unused.
- Each run gains review cost and time. Findings never fail a run. A run fails at the review only when the review cannot produce a result or the workflow cannot read where the implementor started.
- No change to any other folder of the repository.
