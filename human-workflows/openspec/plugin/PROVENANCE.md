# Provenance

This plugin copies its skills from Agent Skills and its workflow from Agent Runner. The copies here
are now the source of truth for define-openspec-change. Agent Skills and Agent Runner were not changed.

## Sources

| Source | Commit |
| --- | --- |
| Codagent-AI/agent-skills, `main` | `9109c2db42f045ad117705961bdeedde6568257c` (2026-10-22) |
| Codagent-AI/agent-runner, `main` | `015129409fe1ae5ecd09e6ea81ffdddbc43c5934` (2026-11-08) |

## Skills

Copied from `skills/<name>/` in Agent Skills at `9109c2d`. The second column is the last Agent Skills
commit that touched the skill.

| File | Last source commit |
| --- | --- |
| `skills/propose/SKILL.md` | `d9c5059` |
| `reviews/proposal-review.md` (from `skills/proposal-review/`) | `d9c5059` |
| `skills/spec/SKILL.md` | `e9b4dfa` |
| `skills/design/SKILL.md` | `d9c5059` |
| `skills/test-plan/SKILL.md` | `8605d33` |
| `reviews/review-approach.md` (from `skills/review-approach/`) | `4b0a362` |
| `skills/ask-questions/SKILL.md` | `d9c5059` |
| `skills/call-agent/SKILL.md` | `6442600` |

Not copied: the `agents/openai.yaml` files beside `skills/test-plan/` and `skills/call-agent/`, and the
plan-tasks and review-tasks skills.

Written here, not copied: `skills/define/SKILL.md` and `skills/setup/SKILL.md`. The setup skill's
recommended models come from Runner's crosscheck profile (Codex) and `lead` profile (Claude).

## Workflow

`workflow.yaml` comes from Agent Runner `workflows/core/define-change-v1.0.yaml` at `0151294`, with
the OpenSpec caller's values from `workflows/openspec/change-v3.0.yaml` (lines 19 to 25) filled in.

The text the server adds around each step comes from Runner's `internal/exec/agent.go` at `0151294`:
the step prefix from `buildStepPrefix`, and the completion instruction from `completionInstruction`.

## Checks

The finish check began as a TypeScript port of `validate-planning-artifacts.sh` (Agent Runner
`workflows/core/validate-planning-artifacts.sh` at `0151294`, the same file the Archon pack uses). The
change-name rule is from `workflows/openspec/validate-change-name.sh`. The existing-change refusal and
`openspec new change` are from `workflows/openspec/create-change.sh`.
