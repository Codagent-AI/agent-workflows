# Provenance

This plugin copies its skills from Agent Skills and its step prompts from Agent Runner. The copies here
are now the source of truth for define-openspec-change. Agent Skills and Agent Runner were not changed.

## Sources

| Source | Commit |
| --- | --- |
| Codagent-AI/agent-skills, `main` | `9109c2db42f045ad117705961bdeedde6568257c` (2026-10-22) |
| Codagent-AI/agent-runner, `main` | `015129409fe1ae5ecd09e6ea81ffdddbc43c5934` (2026-11-08) |

## Skills

Copied from `skills/<name>/` in Agent Skills at `9109c2d`. The second column is the last Agent Skills
commit that touched the skill.

| File | Last source commit | Changes |
| --- | --- | --- |
| `skills/propose/SKILL.md` | `d9c5059` | `codagent:ask-questions` renamed to `define-openspec-change:ask-questions`. |
| `skills/proposal-review/SKILL.md` | `d9c5059` | None. |
| `skills/spec/SKILL.md` | `e9b4dfa` | `codagent:ask-questions` renamed. |
| `skills/design/SKILL.md` | `d9c5059` | `codagent:ask-questions` renamed. |
| `skills/test-plan/SKILL.md` | `8605d33` | `codagent:ask-questions` renamed. Added `name: test-plan` to the front matter. |
| `skills/test-plan/agents/openai.yaml` | `8605d33` | None. |
| `skills/review-approach/SKILL.md` | `4b0a362` | Added `name: review-approach` to the front matter. |
| `skills/ask-questions/SKILL.md` | `d9c5059` | None. |
| `skills/call-agent/SKILL.md` | `6442600` | Rewritten for this plugin's tools. See below. |
| `skills/call-agent/agents/openai.yaml` | `6442600` | Descriptions point at this plugin's call-agent instead of the Runner-owned tool. |

`skills/call-agent/SKILL.md` changes:

- Added `name: call-agent`, and the description now names this plugin's tool instead of the
  Runner-owned one.
- The only target is `agent: "crosscheck"`. The `session` target and the Runner profile wording are
  gone.
- Says the child runs on the CLI that `~/.agent-workflows/config.yaml` picks (the other vendor's when
  it is configured and installed), is read-only, and has none of this plugin's skills or tools, so
  the prompt must name the skill by its absolute `SKILL.md` path. A `crosscheck_not_configured`
  refusal sends the lead to the setup skill.
- Collection: `call_agent` and each `get_agent_call` wait about 100 seconds on the server, so the lead
  polls straight away instead of the 5 to 60 second backoff. The 60-minute bound, the cancel then
  poll rule, and the transport-error rules are kept.
- Adds that the lead must not call `next_step` or end its turn while a call is running.
- "Evaluate the result" and "Report material findings" are unchanged, except that `accepted` is no
  longer a status. The closing paragraph on autonomous evidence was dropped, since define is
  interactive.

Not copied: plan-tasks and review-tasks. Runner's define has five steps and change v3 no longer uses
them.

Written here, not copied: `skills/define/SKILL.md`, the entry point, and `skills/setup/SKILL.md`,
which writes `~/.agent-workflows/config.yaml` with the user. Runner set the crosscheck in its own
`~/.agent-runner/config.yaml` profile, and the setup skill's recommended models come from that
profile (Codex) and from Runner's `lead` profile (Claude).

## Step prompts

`steps/*.md` come from Agent Runner `workflows/core/define-change-v1.0.yaml` at `0151294`, one file
per step, with the OpenSpec caller's values from `workflows/openspec/change-v3.0.yaml` (lines 19 to 25)
filled in:

- `{{change_dir}}` became `openspec/changes/{{change_name}}`;
- `{{change_label}}` became `OpenSpec change`;
- `{{artifact_location_instruction}}` became its OpenSpec text.

Every file renames `codagent:<skill>` to `define-openspec-change:<skill>`. Other changes:

| File | Changes |
| --- | --- |
| `steps/proposal.md` | The intake sentence now refers to the conversation so far instead of intake context supplied above. The child must read and follow the proposal-review skill at `{{skills_dir}}/proposal-review/SKILL.md` instead of using `codagent:proposal-review`, because the child does not load this plugin. |
| `steps/specs.md` | Rename only. |
| `steps/design.md` | Rename only. |
| `steps/test-plan.md` | Rename only. |
| `steps/approach-review.md` | The child must read and follow the review-approach skill at `{{skills_dir}}/review-approach/SKILL.md` instead of using `codagent:review-approach`. |

The server fills `{{change_name}}` and `{{skills_dir}}` (the absolute path of this plugin's `skills/`
folder) when it returns a step.

The server also adds the text Runner added around each step, from `internal/exec/agent.go` at
`0151294`: the step prefix from `buildStepPrefix` ("You are running in the ... workflow", "Continuing
to step ...", "Resuming step: ...", and "Before doing anything else, announce that you are starting
this step."), and a completion instruction adapted from `completionInstruction` that says to call
`next_step` instead of running `agent-runner step complete`.

## Checks

The finish check is a TypeScript port of `validate-planning-artifacts.sh` (Agent Runner
`workflows/core/validate-planning-artifacts.sh` at `0151294`, the same file the Archon pack uses) for
`change_kind=openspec` and `require_tasks=false`. The change-name rule is from
`workflows/openspec/validate-change-name.sh`. The existing-change refusal and `openspec new change`
are from `workflows/openspec/create-change.sh`, without its agent-validator checks.
