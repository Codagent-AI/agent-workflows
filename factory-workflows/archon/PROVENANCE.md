# Provenance

## Skills

`skills/` holds this pack's own copies of the Codagent skills its agents load. They are copied from
Agent Skills (`Codagent-AI/agent-skills`, `main` at `9109c2db42f045ad117705961bdeedde6568257c`,
2026-10-22) and are now the source of truth for the pack. Agent Skills is deprecated: change the
skills here, and don't copy from it again.

| Folder | Last Agent Skills commit that touched it | Changes |
| --- | --- | --- |
| `skills/implement-change/` | `002e9e8` | None. |
| `skills/verify-behavior/` | `7f994ed` | None. |
| `skills/prepare-acceptance/` | `a4e5a34` | None. |
| `skills/session-report/` | `7c00678` | None. |
| `skills/wait-ci/` | `3919c92` | None. |
| `skills/review-assumptions/` | `d9c5059` | None. |

The first five are the ones the workflows and these skills name. `review-assumptions` is not a step
in the port, but the first scored repetition's agents read it, so it is kept.

`scripts/install-skills.sh` installs each folder into the target checkout as `codagent-<name>`,
changing only the `name:` line of its `SKILL.md`.

Before the move, the and-scene repetitions installed every skill in Agent Skills at `9109c2d`. The
pack now installs only these six. No paid run has used the smaller set yet.

## Agent Runner scripts

`.archon/workflows/codagent/.shared/core/` holds Agent Runner's shell checks, copied unchanged. See
`AGENTS.md`.
