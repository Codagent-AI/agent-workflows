## Why

This change is for the Archon pack in `factory-workflows/archon/`. It builds on the `add-validation` change, which folds verification into `codagent-implement-change`, removes the `@lead` role, and adds the `@reviewer` role and its code review.

A pack run ends at a draft pull request and an acceptance status. The workflows the pack was ported from went further. After acceptance, Agent Runner's `openspec:change` (v3.0) archived the OpenSpec change and finalized the pull request: it marked the pull request ready, waited for CI, fixed CI failures and review comments, and failed unless the final CI passed. In the pack, a person has to do these steps by hand.

Agent Runner also had human steps inside the workflow: resolving undecided assumptions, reviewing and refining the change, and choosing whether to run re-acceptance testing. They held the run open until a person answered. The pack runs with no person in the loop, so it never ported them, and nothing took their place. A person gets a draft pull request with a summary description. The decisions agents made and the testing evidence sit in files in the run's local artifacts folder: `acceptance-handoff.md`, `acceptance-assumptions.md`, `implementor-decisions.md`, the audit, and the review results. Nothing ranks what needs the person's attention, and none of it is in the pull request.

Paul's notes from AI DevCon 2026 ("Codagent: Factory Loop, Evals, and Newsletter Notes", in the Professional Knowledge folder) describe the review this change prepares for:

- AI produces evidence, and humans review it. The developer decides what checks cannot settle.
- A pull request should show what was intended, what was decided, and what was verified.
- Decisions happen during the definition, during implementation, and while agents argue in review. The pull request shows the decision log, and the log also lives outside the pull request, so later agents can read it.
- Spend people's review where the risk is.

The Agent Factory, which ran Codagent work before Archon replaced it, did a version of this. Its runs kept `decisions.md` in the change folder, ranked every review item in one of four tiers (red, orange, yellow and white), and wrote a "Review first" section into the pull request description.

Three more gaps:

- **Two roles review independently.** `@crosscheck` runs the audit, and `@reviewer` runs the code review that `add-validation` adds. A project binds both for the same kind of job.
- **An implementor that stops early is not sent back.** When the implement turn ends before the change is finished, the pack goes on to the evidence check and its two repairs, which only complete the checklist. Agent Runner added a completion loop after the port, which the issue "Port Agent Runner's implementation completion loop to codagent-implement-change" tracks.
- **The pack carries a change kind it should not.** Agent Runner had two flavors of change: OpenSpec, and spec-driven as its alternative. The pack is meant to support only OpenSpec, but the port brought spec-driven along, in four settings and in branches of the definition check, the definition commit and the checklist.

## What Changes

- **The audit runs on `@reviewer`.** Its command, its place and its fix path stay the same, and it keeps its `large` fallback. The `@crosscheck` role is removed.
  - **BREAKING:** a project's `@crosscheck` binding goes unused. The audit uses the project's `@reviewer` binding.
- **Completion loop.** Each implement turn ends only after the implementor writes a completion record or a blocked record. A script checks that the change is complete. When the check fails, a judge decides why. The judge is an inspection-only agent on `@tester`, in a fresh session, and it gives one verdict:
  - `blocked`: only a human can unblock the work. The judge writes the blocked record, and the run stops.
  - `continue`: work remains. The judge lists it, and the implementor continues with that list. At most three times.
  - `fix-record`: the work is done, but the record is incomplete. The judge fills in only the checklist's Code, Evidence and Status cells, or writes the completion record. At most twice.
  - `complete`: the only gaps are rows marked not verified with a reason. A script accepts this only when its own check agrees.

  A script checks each verdict and enforces the limits. The loop replaces the evidence check and its two `complete-evidence` repairs.
- **Archive** the change, after the acceptance rounds end. A script validates and archives the change with `openspec validate` and `openspec archive`. When that fails, the implementor repairs the change's delta once, editing only files under the change folder. A check then verifies the archive commit, and the implementor repairs the commit once, staging only the archive's paths. When the archive still fails after its repairs, the run keeps what the archive left and goes on.
- **Finalize**, after the archive, whether or not it succeeded. The workflow marks the pull request ready for review and waits for CI on its head. When CI fails or the pull request has review comments to act on, the implementor fixes them within the approved scope, up to three cycles. A comment counts whoever wrote it, the pull request's author included, except the run's own replies, which the implementor marks; today the pack drops the author's comments, but the run opens the pull request with the user's login. A last CI wait then checks the final head. As in Agent Runner, finalize passes only when every check on that head passed, with no blocking review, no merge conflict and no review comment left to act on. Anything else fails it, including checks still running when the wait ends.
- **A review package, written into the pull request at the end of every run whose acceptance rounds end**, whatever failed before it. The person's review is not a workflow step. It happens after the run. The person relies on the package to surface what went wrong or needs their call, so what went right is collapsed or left out. The run prepares:
  - **A decision log**, `decision-log.md`, that the agents write as they work and a script commits in the change folder after the acceptance rounds, so archiving keeps it with the change. Entries made after that commit go into the committed log. It holds each point the definition did not settle that an agent settled on its own and that could change behavior, scope or integration: a choice the definition left open, a reading of an ambiguous or conflicting requirement, a planned check that could not work, a reproduced violation judged not to be one, and the acceptance tester's assumptions. It also holds each defect the agents agreed not to fix, with the reason. Nothing that only confirms work went as expected is logged.
  - **A dispute log**, `dispute-log.md`, committed beside it, with both sides of each review finding the reviewer and the implementor still disagree on or that was never fixed, each audit finding the implementor did not fix, and each pull request review comment the finalize fixer did not fix. The person then has no comment replies to read.
  - These two logs replace the run files `implementor-decisions.md` and `acceptance-assumptions.md`, and the check that the second one is not empty.
  - **The testing evidence**: each spec behavior's verdict and evidence from the checklist, what the acceptance tester exercised and what it did not, text equivalents of its screenshots, the human-only checks the test plan reserves for a person, and each commit after acceptance with the tests that cover it. Screenshots and logs stay in the run's artifacts folder. CI is not repeated, because the pull request's required checks show it.
  - **A "Review first" section in the pull request description.** An agent ranks every item from the testing evidence, the decision log and the dispute log in one of the Agent Factory's four tiers, by its rules without their Agent Validator, task-compliance, resume and plan-revision parts. The script adds a red item for each failed acceptance, archive or finalize from the run's own results. A script checks the ranking and writes the section into the generated part of the description. The check builds its own list of the items that must appear, from files the ranking agent does not write, and rejects a ranking that leaves one out or puts it in a lower tier:
    - the checklist's failed and unverified rows, which must be red;
    - a failed acceptance, archive or finalize, which must be red;
    - each dispute-log entry other than a pull request comment, which must be at least orange;
    - every commit after the accepted head, from the git history, which must be at least orange.

    The ranking agent repairs a rejected ranking once. If it is still wrong, the script places the required items in their tiers itself, so the package is still written. The agent ranks everything else by judgment. The section gives the run's state, every red item and up to five orange items. Each item starts with its type: Failure, Verification, Decision, Dispute, Late commit or Human check. Below the change summary, the rest of the items, the testing evidence, the decision log and the dispute log are each collapsed. This covers the issue "Show the code review's decision log in the draft pull request description".
- **A failure does not stop the steps after it.** When acceptance does not converge, the archive and finalize still run, including when an acceptance fix stopped on a decision only the user can make or a push still failed after its repair. When the archive fails, finalize still runs. Each failure goes at the top of "Review first" as a red item that blocks the merge, saying what failed and what is left to do. A run ends in one of three states. It succeeded when acceptance converged, the archive and finalize succeeded, and the package is in the pull request. It needs attention when the package is in the pull request but acceptance, the archive or finalize failed. Archon shows both as completed, with outcome succeeded or failed. It failed only when a major blocker stopped it before the pull request had its package, such as an implementation blocked before the pull request or a package that could not be written.
- **Only OpenSpec changes.** The spec-driven kind, which the port brought over by mistake, is removed. The `change_kind`, `changes_root`, `change_label` and `artifact_validation_instruction` settings go. Every change lives in `openspec/changes/<name>`, inside the repository, and agents get the `openspec validate` sentence the pack derives from the change name. The definition check's spec-driven requirement check, the rule that a spec-driven definition must already be committed, and the checklist's case for a change folder outside the repository go with them.
  - **BREAKING:** a project that sets any of the four settings has its run refused at launch. Archon refuses it, because the pack no longer declares them, so the pack needs no check of its own.
- Add dry-run fixtures for the new branches and bun tests for the new shared modules. Update `factory-workflows/archon/README.md`, `PROVENANCE.md` and `AGENTS.md`. `PROVENANCE.md` records the new sources: Agent Runner's `openspec/archive-change-v1.0.yaml`, `core/finalize-pr-v1.0.yaml` and the completion loop in `core/implement-change-v2.0.yaml` at `01512940`, the Agent Factory's tier rules and pull request section, and the fixer prompt of Agent Skills' `fix-pr` skill, which the pack now owns. It also records that the pack dropped Agent Runner's spec-driven kind.

A run now ends with a pull request that is ready for review, where it used to end with a draft. The change is archived before a person reviews it.

## Capabilities

### New Capabilities

- `change-archive`: archiving the change at the end of a run: when it runs, the transition and its repair, the commit check and its repair, and what a failure does to the run.
- `pull-request-finalization`: marking the pull request ready, the CI wait and fix cycles, the final CI check, and the run's three end states.
- `review-handoff`: the review package: the decision log and the dispute log and what they collect, the testing evidence summary, the tier rules, the check of the ranking, and the "Review first" section.

### Modified Capabilities

- `change-implementation`: the completion loop replaces the evidence repairs, the audit runs on `@reviewer`, an audit finding the implementor does not fix goes to the dispute log, the assumptions handoff check goes, and the definition check and commit lose the spec-driven kind.
- `acceptance-rounds`: when the rounds end, converged or not, the run goes on to the archive and finalize, and the assumptions ledger check goes.
- `draft-pull-request`: the pull request becomes ready at finalize, the description gains the "Review first" section, and the CI wait counts the pull request author's comments and leaves out the run's own replies.
- `pack-settings-and-run-files`: the roles lose `@crosscheck`, the settings lose the four change-kind settings, the change folder is always `openspec/changes/<name>`, and the run's `implementor-decisions.md` and `acceptance-assumptions.md` give way to the decision and dispute logs, beside the completion loop's files, the tier file and the finalize CI reports.
- `change-review`: the review hand-off writes findings that were not fixed to the dispute log, and declines the reviewer accepted to the decision log, instead of `acceptance-assumptions.md`. This capability is added by `add-validation`.

## Technical Approach

The change follows the pack's existing patterns and the shape `add-validation` leaves: one implement workflow, no lead, and the implementor taking over the steps after the session report.

- **The new steps go in `codagent-implement-change`.** Archon lets a node resume only a node of its own workflow, so the archive repairs and the finalize fixes can continue the implementor's session only from there. Agent Runner's archive repair relied on that: the agent that made the change knows its decisions when it reconciles a delta.
- **The completion loop is a `loop_group`.** Its iteration ceiling is a literal, as Archon requires. Its continue node resumes the implementor. The judge is a fresh `@tester` node with a `medium` fallback. Agent Runner's completion and verdict checks are ported to TypeScript under `.shared/lib/`, with bun tests ported from its Go tests.
- **The archive transition is a script node** that runs the `openspec` CLI, which the definition check already needs. Its repairs are agent nodes with the pack's structured blocked output.
- **Finalize uses the pack's own forge layer.** A script marks the pull request ready through `archon forge`, as the pack already opens it and keeps it a draft. The CI waits reuse the `wait-ci` script and its report. `check-forge` checks the new operation before any agent spends.
- **The tiers are ported from the Agent Factory.** Its rules become the ranking agent's instructions. Its renderer (`annotate-pr.py`) is ported to TypeScript. Its classification check (`verify-classification.py`) is ported and extended. The Factory's check reads only the ranking agent's file, so it cannot see an item left out; the ported check also reads the checklist, the review results, the run's failures and the git history. The section goes in the body between the pack's generated-body markers.

Decisions `design.md` settles:

- **When the decision and dispute logs are written and committed** relative to the archive and finalize, and how finalize's own decisions reach it.
- **Which agent ranks the items.** The reviewer, in a fresh session after finalize.
- **Which session each later step resumes.** `add-validation` keeps the implementor in one session, continued in place, with one output shape on every implementor step, and starts `open-draft-pr` in a fresh session. So the archive repairs and the finalize fixes need another step of the implementor's session to resume.
- **How the review package builds on the tester's `acceptance-handoff.md`** without repeating it.
- **How the run goes on past a failed step.** Today a check that still fails after its repairs stops the run. Acceptance, the archive and finalize need a path that records the failure and continues.

Risks:

- **The archive runs before the person's review**, even when acceptance did not pass. If the person asks for changes after the run, those changes edit the main specs under `openspec/specs/`, because the change is already archived and OpenSpec has no way to undo an archive. Agent Runner archived after its human steps.
- **The pull request is marked ready before a person looks at it**, even when a step failed. CI and review bots treat it as ready. Only a person merges, and the "Review first" section says what blocks the merge and what to check.
- **The ranking agent could understate a risk.** The check puts the mechanical cases in their tier and rejects a ranking that leaves one out, but it cannot judge the rest.
- **It relies on the Codagent-AI Archon fork's resume**, as `add-validation` does. There a resume continues the implementor's session in place, so later steps see the completion loop's continue turns. On stock Archon each resume forks: nothing fails, but later steps do not see those turns, and they miss the prompt cache.
- **Each run costs more and takes longer.** Judge turns, continue passes, the finalize CI waits (up to 15 minutes each) and fix cycles all add to it.
- **This is a large change.** It touches the implementation half and the end of the run. Fixtures and bun tests cover each part on its own.
- **It depends on `add-validation`.** It must be implemented after that change merges.

## Out of Scope

- The person's review itself, changes the person asks for after the run, and re-acceptance testing of those changes. With no human step in the run, nothing triggers Agent Runner's re-acceptance testing or its gate.
- Agent Runner's Agent Validator steps: the validator run in acceptance and the validator baseline in the archive. `PROVENANCE.md` already records that the pack leaves Agent Validator out.
- Merging the pull request, and the Agent Factory's automatic merge of low-risk pull requests.
- Promoting recurring decisions into rules or specs.
- Publishing the evidence anywhere other than the pull request and the repository, such as a claude.ai artifact.
- Any change to Archon.
- Any change to the define-openspec-change plugin, including its own crosscheck agent, which is a different role.
- Measuring the change in evaluation runs, which is done outside this repository.

## Impact

- Changes under `factory-workflows/archon/.archon/workflows/codagent/`:
  - `implement-change/` gets the completion loop, the archive, finalize and the review package, with their commands, scripts and fixtures, and the audit node moves to `@reviewer`.
  - `.shared/lib/` gets the completion, archive, finalize and tier modules.
  - `.pack/pack.yaml` loses the four change-kind settings, and `check-definition/`, `commit-definition/` and the shared planning code lose their spec-driven branches, with their fixtures.
- Tests under `factory-workflows/archon/tests/`.
- `factory-workflows/archon/README.md`, `PROVENANCE.md` and `AGENTS.md`.
- Runtime needs: nothing new. The `openspec` CLI and the forge plugin are already required.
- A project's `@crosscheck` binding goes unused. A project that sets `change_kind`, `changes_root`, `change_label` or `artifact_validation_instruction` has its run refused.
- A run marks its pull request ready, commits `decision-log.md` and `dispute-log.md` in the change folder, and archives the change. Each run costs more and takes longer.
- The run no longer writes `implementor-decisions.md` or `acceptance-assumptions.md`, and the assumptions handoff check and its repair go.
- The issues "Port Agent Runner's implementation completion loop to codagent-implement-change" and "Show the code review's decision log in the draft pull request description" are covered by this change.
- No change to any other folder of the repository.
