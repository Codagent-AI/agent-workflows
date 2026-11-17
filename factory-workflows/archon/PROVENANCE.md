# Provenance

This is the only file in the pack that names the projects it was ported from.

## Sources

- **Agent Runner** (`Codagent-AI/agent-runner`, `8927934ba4ee327214a3cf6bfc76e15eb2d0d319`, 2026-10-25): the workflows `core/implement-change-v2.0.yaml`, `core/verify-change-v1.0.yaml`, `core/check-definition-v1.0.yaml` and `core/commit-definition-v1.0.yaml`, their agent prompts, and the shell checks they call.
- **Agent Skills** (`Codagent-AI/agent-skills`, `main` at `9109c2db42f045ad117705961bdeedde6568257c`, 2026-10-22): the skills those workflows' agents load.

The pack is now the source of truth for all of it. Agent Skills is deprecated: never copy from it again or read it at run time.

## Where each part went

| Source | Here |
| --- | --- |
| The four workflows | `implement-change/` (including verification), `check-definition/`, `commit-definition/`. Agent prompts are the `commands/*.md` files. |
| `validate-change-name.sh`, `validate-boolean-param.sh`, `validate-nonempty-param.sh` | `.shared/lib/params.ts` |
| `validate-planning-artifacts.sh` | `.shared/lib/planning.ts` |
| `commit-change-plan.sh` | `.shared/lib/commit-plan.ts` |
| `check-not-blocked.sh` and the workflows' inline git checks | `.shared/lib/worktree.ts` |
| `check-evidence.sh` and implement-change's inline checklist checks | `.shared/lib/checklist.ts`, `checklist-plan.ts` and `evidence.ts` |
| `acceptance-gate.sh` and verify-change's inline round steps | `.shared/lib/acceptance.ts` |
| `check-draft-pr.sh`, `acceptance-push.sh`, `update-pr-body.sh` | `.shared/lib/pull-request.ts`, with `.shared/lib/forge.ts` |
| Skill `implement-change` (last touched at `002e9e8`) | `.shared/implement-change.md`, without its front matter. |
| Skill `verify-behavior` (`7f994ed`) | `.shared/verify-behavior.md`, without its front matter. |
| Skill `prepare-acceptance` (`a4e5a34`) | Split between `implement-change/commands/acceptance-test.md` (everything but "Wait for CI and hand off") and `acceptance-handoff.md` (that section). "This skill" became "these instructions" or "this step". `agents/openai.yaml` is dropped. |
| Skill `session-report` (`7c00678`) | Inlined in `implement-change/commands/session-report.md`. |
| Skill `wait-ci` (`3919c92`) | `check-ci.sh` and `get-pr-comments.sh` ported to `.shared/lib/ci.ts`, `ci-comments.ts` and `ci-report.ts`, run by the `wait-ci` script node. The tester still judges what a comment means, in `acceptance-handoff.md`. |
| Skill `review-assumptions` (`d9c5059`) | Not carried. The standalone assumption review and simplification have been removed. |

The tests in `tests/*.test.ts` port Agent Runner's Go test cases for the shell checks, and the `wait-ci` skill's shell tests.

## Differences from Agent Runner

Each of these can change what a run does or costs.

1. **No `call_agent`.** Where Agent Runner's agents escalate a question to the lead, the agents here rule on it themselves and record the ruling in `decision-log.md`. `check-lead-decisions.sh` is not ported.
2. **No Agent Validator.** The validator steps, `run-validator.sh`, the validator half of `commit-change-plan.sh`, and the `skip_validator` input are gone. The prompts still tell agents not to run it.
3. **The implementor's session continues in place, on the Codagent-AI Archon fork.** As in Agent Runner, a fix continues the implementor's session, and later steps see it. Upstream Archon forks a resumed session instead, so on it a repair's turns would not reach later steps. Every step on the session returns one output schema, and a step returns the fields it does not use empty, because a schema change misses the provider's prompt cache.
4. **The tester starts fresh each round.** Archon continues a session across a loop's iterations only from an owner node that ran before the loop, and the tester has none. Earlier rounds' evidence files carry the context forward.
5. **At most 10 acceptance rounds.** A loop's iteration ceiling must be a literal.
6. **The CI wait is a script node.** The tester's turn is split in two: `acceptance-test` explores and says whether CI is worth waiting for, the `wait-ci` node polls for up to 15 minutes, and `acceptance-handoff` resumes the tester to judge the result and write the handoff. A round that is not ready and not the last writes a short handoff (head, reason, findings and log paths), because the next round replaces it; Agent Runner wrote the full handoff every round. When no check has appeared 3 minutes into the wait, the node treats the branch as having no CI and reports as it would at the deadline. The skill polled the full 15 minutes.
7. **A blocked repair answers in structured output.** A repair returns `{blocked, reason}` instead of a trailing `REPAIR_BLOCKED` line, and the recheck fails with `REPAIR_BLOCKED: <reason>`.
8. **Agents run on the host**, not in a sandbox.
9. **The autonomy preamble repeats.** Every `context: fresh` node's command starts with it. `repair-definition` is one of them: each repair starts a fresh session and is given the problems again.
10. **Session files move to `$ARTIFACTS_DIR`.** The files agents write keep their names, with `{{session_dir}}/output/` replaced by `$ARTIFACTS_DIR/`, and the `session_dir` input is gone. Archon saves the audit under `nodes/`, and the session report is a file the implementor writes to `$ARTIFACTS_DIR/session-report.md`. There is no `audit.log`.
11. **Repairs that rerun a step reuse its command.** `reopen-draft-pr` resumes `open-draft-pr` with the same command, so the preamble appears twice in that session.
12. **The tester stops what it starts.** Archon waits for every command a Codex turn started, so `acceptance-test` and `acceptance-handoff` end by stopping every server and long-running command the tester started.
13. **The pull request body markers are `<!-- codagent:generated-body:start -->` and `<!-- codagent:generated-body:end -->`**, instead of `agent-runner:generated-body`. A body written by Agent Runner gets a second generated block.
14. **The published package declares the authored outcome.** Acceptance, archive and finalize must pass for succeeded. A published package with a failed step completes with outcome failed (needs attention). Inability to publish fails the run.
15. **The pull request body is updated by a script node.** `open-draft-pr` writes its description to `$ARTIFACTS_DIR/pr-body.md`, and the `publish-draft-pr` node adds the generated-body markers and puts it in the body. Agent Runner's agent ran `update-pr-body.sh` itself. The description reports no test or validation results, because the review package reuses it after later steps change the code.
16. **Where a step started comes from Archon.** The checklist and implementation-commit checks read `$node.execution.checkoutStart` where Agent Runner recorded the head and the worktree status in steps of its own.
17. **Only OpenSpec remains.** The spec-driven kind ported from Agent Runner is dropped, with change_kind, changes_root, change_label and artifact_validation_instruction. Archon rejects removed project settings. The only required launch input is change_name; remaining defaults are review_strategy, acceptance_rounds, acceptance_fix_scope and stop_after.
18. **The folder and validation sentence are fixed by the name.** Every change lives at openspec/changes/name inside the repository. The workflow commits its definition and checklist.
19. **The forge goes through `archon forge`, not `gh`, except for comments.** Lookup by head branch, body edits, draft state, checks, failed-check logs, reviews, mergeability and repository resolution are forge operations, and every script reads the JSON envelope. Agent Runner called `gh`, the REST API and GraphQL. A forge refusal or an unverified write is a failed check with the outcome in its text. The pull request's review threads and conversation comments are still read with one `gh` GraphQL query, because the forge's actor record has no account type and the bot test needs `__typename`.
20. **The pack, not an agent, creates the draft pull request and keeps it a draft.** Agent Runner's `open-draft-pr` agent ran `gh pr create --draft` and `gh pr ready --undo`. Here the agent pushes and writes `pr-title.txt` and `pr-body.md`, the `publish-draft-pr` script opens the pull request (or updates the existing one and converts it to draft), and `restore-draft-pr` converts it back after each acceptance push. The repair prompts tell an agent to push only.
21. **A first node checks the forge.** `check-forge` runs `archon forge check` for the remote's host with the operations above, so a missing plugin or token refuses the run before an agent spends. Agent Runner found out at the first `gh` call.

22. **Verification is folded into implementation.** `codagent-verify-change` is no longer launchable. Its nodes, scripts, commands and fixtures live in `implement-change/`. Standalone assumption review, simplification, `skip_implementation_review` and `stop_unchanged_acceptance` are removed. An unchanged acceptance fix always stops unless it asks for a retest.
23. **No lead role.** Definition repairs are fresh implementor sessions. The clean-worktree repairs continue the implementor's session, and so do the acceptance fixes. The draft step writes the pull request in a fresh session. Push and draft repairs use the implementor too.
24. **The pack's builtin review replaces the source validator at the same two points without gating on findings.** After the assumptions handoff and before the draft's clean check, it reviews the whole change, followed by at most three fix/re-review rounds. Acceptance fixes get one round before push. A later commit before opening the draft gets a fresh tail review with no fixer. `review_strategy` defaults to `builtin`; `none` disables it.
25. **The reviewer prompts are copied verbatim from Agent Validator** (`Codagent-AI/agent-validator`, commit `24e6f3e`): `src/built-in-reviews/code-quality.md`, `src/built-in-reviews/security.md`, `src/built-in-reviews/error-handling.md`, in that order. They are inlined in `implement-change/commands/review-change.md`; the task's JSON schema replaces their reasoning format. The validator executable is never run.
26. **The implementor and reviewer debate findings by stable IDs.** A fixer commits a fix or declines with a reason, the reviewer confirms/rejects or contests once, and the implementor can reply. Continued disagreement becomes disputed. Unfixed high/medium findings and accepted declines are handed to the person with both sides; low findings stay in the result. Findings do not fail the run. Invalid review output or an unreadable start revision does.
27. **A run can end after acceptance, where the source's implement workflow ended.** `stop_after: acceptance` skips the logs commit, the archive, finalize and the review package, leaving a draft pull request and the change unarchived, and the run succeeds when acceptance converged. Evals use it to match Agent Runner's implement-change, which ended after verify-change; the default, `finish`, runs every step.
28. **Rows still not verified are rechecked once, after acceptance.** Agent Runner ran Agent Validator, with the project's full checks, after each acceptance fix. The pack instead has the implementor rerun only the checks of the checklist rows still `not verified` when the rounds end, before the stop point, and commit the checklist. A run that stops after acceptance pushes that commit itself.

## Completion, archive, finalize and review handoff

- Agent Runner at `01512940`: the completion loop in `core/implement-change-v2.0.yaml`, `openspec/archive-change-v1.0.yaml`, `core/finalize-pr-v1.0.yaml` and their completion/archive/CI/resume Go tests. Completion, archive and finalize are shared TypeScript modules. The pack keeps post-audit evidence repairs, adds report-mode continuation after late failures, and uses the implementor's session instead of the lead's.
- Agent Factory at `96a3daf`, `src/agent_factory/work_kinds/pull_request/workflow/`: tier rules and PR section from `factory-feature-v1.0.yaml`, `verify-classification.py` and `annotate-pr.py`. A checklist row that is not verified is red even when a named test covers it: the factory ranked only after Agent Validator passed the suites, and the pack runs no validator. The port omits Agent Validator, task-compliance, resume and plan-revision rules. It independently inventories failed/unverified checklist rows, non-PR disputes and post-acceptance code commits; failed steps are script-generated red items. One repair precedes deterministic placement.
- Agent Skills at `9109c2db`: the Fixer Subagent Prompt in `skills/fix-pr/SKILL.md` is now owned by `implement-change/commands/fix-pr.md`. The skill's dispatch, validator, push and wrapper steps are excluded. Previously copied skills are never re-synced and nothing reads Agent Skills at runtime.

| Source | Here |
| --- | --- |
| Completion checks and verdict/resume scripts | `.shared/lib/completion.ts`, `completion-run.ts` and completion script nodes |
| Archive transition and commit checks | `.shared/lib/archive.ts` |
| Finalize CI gate and report reuse | `.shared/lib/finalize.ts` alongside `ci.ts` |
| Factory tier check and PR annotation | `.shared/lib/review-inventory.ts`, `review-package.ts` |
| Fixer Subagent Prompt | `implement-change/commands/fix-pr.md` |

`ci-comments.ts` counts the PR author's comments and excludes the run's marked replies, unlike the copied wait-ci skill's author filter. Decision/dispute logs replace the assumptions/implementor-decision files; accepted declines become decisions, unresolved findings become disputes. Logs commit before archive, late entries update the committed copy, and the ready PR receives the package after finalize. The run never merges and leaves out the source's validator steps.
