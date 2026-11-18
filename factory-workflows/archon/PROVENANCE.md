# Provenance

This is the only file in the pack that names the projects it was ported from.

## Sources

- **Agent Runner** (`Codagent-AI/agent-runner`, `8927934ba4ee327214a3cf6bfc76e15eb2d0d319`, 2026-10-25): the workflows `core/implement-change-v2.0.yaml`, `core/verify-change-v1.0.yaml`, `core/check-definition-v1.0.yaml` and `core/commit-definition-v1.0.yaml`, their agent prompts, and the shell checks they call.
- **Agent Skills** (`Codagent-AI/agent-skills`, `main` at `9109c2db42f045ad117705961bdeedde6568257c`, 2026-10-22): the skills those workflows' agents load.
- **Agent Validator** (`Codagent-AI/agent-validator`, commit `24e6f3e`): the built-in review prompts `src/built-in-reviews/code-quality.md`, `src/built-in-reviews/security.md` and `src/built-in-reviews/error-handling.md`.

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
| Agent Validator's code-quality, security and error-handling review prompts | Inlined word for word, in that order, in `implement-change/commands/review-change.md`. |

The tests in `tests/*.test.ts` port Agent Runner's Go test cases for the shell checks, and the `wait-ci` skill's shell tests.

## Completion, archive, finalize and review handoff

- Agent Runner at `01512940`: the completion loop in `core/implement-change-v2.0.yaml`, `openspec/archive-change-v1.0.yaml`, `core/finalize-pr-v1.0.yaml` and their completion/archive/CI/resume Go tests. Completion, archive and finalize are shared TypeScript modules.
- Agent Factory at `96a3daf`, `src/agent_factory/work_kinds/pull_request/workflow/`: tier rules and PR section from `factory-feature-v1.0.yaml`, `verify-classification.py` and `annotate-pr.py`.
- Agent Skills at `9109c2db`: the Fixer Subagent Prompt in `skills/fix-pr/SKILL.md` is now owned by `implement-change/commands/fix-pr.md`.

| Source | Here |
| --- | --- |
| Completion checks and verdict/resume scripts | `.shared/lib/completion.ts`, `completion-run.ts` and completion script nodes |
| Archive transition and commit checks | `.shared/lib/archive.ts` |
| Finalize CI gate and report reuse | `.shared/lib/finalize.ts` alongside `ci.ts` |
| Factory tier check and PR annotation | `.shared/lib/review-inventory.ts`, `review-package.ts` |
| Fixer Subagent Prompt | `implement-change/commands/fix-pr.md` |
