# Provenance

This is the only file in the pack that names the projects it was ported from.

## Sources

- **Agent Runner** (`Codagent-AI/agent-runner`, `8927934ba4ee327214a3cf6bfc76e15eb2d0d319`, 2026-10-25): the workflows `core/implement-change-v2.0.yaml`, `core/verify-change-v1.0.yaml`, `core/check-definition-v1.0.yaml` and `core/commit-definition-v1.0.yaml`, their agent prompts, and the shell checks they call.
- **Agent Skills** (`Codagent-AI/agent-skills`, `main` at `9109c2db42f045ad117705961bdeedde6568257c`, 2026-10-22): the skills those workflows' agents load.

The pack is now the source of truth for all of it. Agent Skills is deprecated: never copy from it again or read it at run time.

## Where each part went

| Source | Here |
| --- | --- |
| The four workflows | `implement-change/`, `verify-change/`, `check-definition/`, `commit-definition/`. Agent prompts are the `commands/*.md` files. |
| `validate-change-name.sh`, `validate-boolean-param.sh`, `validate-nonempty-param.sh` | `.shared/lib/params.ts` |
| `validate-planning-artifacts.sh` | `.shared/lib/planning.ts` |
| `commit-change-plan.sh` | `.shared/lib/commit-plan.ts` |
| `check-not-blocked.sh` and the workflows' inline git checks | `.shared/lib/worktree.ts` |
| `check-evidence.sh` and implement-change's inline checklist checks | `.shared/lib/checklist.ts` |
| `acceptance-gate.sh` and verify-change's inline round steps | `.shared/lib/acceptance.ts` |
| `check-draft-pr.sh`, `acceptance-push.sh`, `update-pr-body.sh` | `.shared/lib/pull-request.ts` |
| Skill `implement-change` (last touched at `002e9e8`) | `.shared/implement-change.md`, without its front matter. |
| Skill `verify-behavior` (`7f994ed`) | `.shared/verify-behavior.md`, without its front matter. |
| Skill `prepare-acceptance` (`a4e5a34`) | Split between `verify-change/commands/acceptance-test.md` (everything but "Wait for CI and hand off") and `acceptance-handoff.md` (that section). "This skill" became "these instructions" or "this step". `agents/openai.yaml` is dropped. |
| Skill `session-report` (`7c00678`) | Inlined in `implement-change/commands/session-report.md`. |
| Skill `wait-ci` (`3919c92`) | `check-ci.sh` and `get-pr-comments.sh` ported to `.shared/lib/ci.ts`, run by the `wait-ci` script node. The tester still judges what a comment means, in `acceptance-handoff.md`. |
| Skill `review-assumptions` (`d9c5059`) | Not carried. The `review-assumptions` node uses Agent Runner's own prompt, which does not name the skill. |

The tests in `tests/*.test.ts` port Agent Runner's Go test cases for the shell checks, and the `wait-ci` skill's shell tests.

## Differences from Agent Runner

Each of these can change what a run does or costs.

1. **No `call_agent`.** Where Agent Runner's agents escalate a question to the lead, the agents here rule on it themselves and record the ruling in `acceptance-assumptions.md` (or an ordinary decision in `implementor-decisions.md`). `check-lead-decisions.sh` is not ported.
2. **No Agent Validator.** The validator steps, `run-validator.sh`, the validator half of `commit-change-plan.sh`, and the `skip_validator` input are gone. The prompts still tell agents not to run it.
3. **A repair forks its role's session.** In Agent Runner a fix continues the role's named session, and later steps see it. Here a repair resumes a fork, and the role's main line continues from before the repair.
4. **The tester starts fresh each round.** Archon cannot resume a session across loop iterations. Earlier rounds' evidence files carry the context forward.
5. **At most 10 acceptance rounds.** A loop's iteration ceiling must be a literal.
6. **The CI wait is a script node.** The tester's turn is split in two: `acceptance-test` explores and says whether CI is worth waiting for, the `wait-ci` node polls for up to 15 minutes, and `acceptance-handoff` resumes the tester to judge the result and write the handoff. With no checks configured, the node polls the full 15 minutes, as the skill did.
7. **A blocked repair answers in structured output.** A repair returns `{blocked, reason}` instead of a trailing `REPAIR_BLOCKED` line, and the recheck fails with `REPAIR_BLOCKED: <reason>`.
8. **Agents run on the host**, not in a sandbox.
9. **The autonomy preamble repeats.** Every `context: fresh` node's command starts with it, and so does `repair-definition`, whose later loop iterations continue one session and see it again.
10. **Session files move to `$ARTIFACTS_DIR`.** The files agents write keep their names, with `{{session_dir}}/output/` replaced by `$ARTIFACTS_DIR/`, and the `session_dir` input is gone. Archon saves the audit and the session report under `nodes/`. There is no `audit.log`.
11. **Repairs that rerun a step reuse its command.** `reopen-draft-pr` resumes `open-draft-pr` with the same command, so the preamble appears twice in that session.
12. **The tester stops what it starts.** Archon waits for every command a Codex turn started, so `acceptance-test` and `acceptance-handoff` end by stopping every server and long-running command the tester started.
13. **The pull request body markers are `<!-- codagent:generated-body:start -->` and `<!-- codagent:generated-body:end -->`**, instead of `agent-runner:generated-body`. A body written by Agent Runner gets a second generated block.
