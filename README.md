# agent-workflows

Codagent workflows for the [Archon](https://github.com/coleam00/Archon) engine.

The first workflow is a port of Agent Runner's `core:implement-change` (v2.0, agent-runner `8927934b`), built to test whether Codagent's workflow can run on Archon and keep a similar score and cost on the and-scene eval.

## Layout

```
.archon/workflows/codagent/          the codagent pack (Archon namespace)
  implement-change/                  entry point: codagent-implement-change
  verify-change/                     crosscheck audit, acceptance rounds, draft PR
  check-definition/                  definition checks and repairs
  commit-definition/                 commit the planned definition
  .shared/core/                      Agent Runner's shell checks, copied unchanged
  .shared/bin/                       small helpers the nodes share
roles/baseline.yaml                  role bindings matching the eval baseline
scripts/install-skills.sh            copy pinned Codagent skills into a checkout
scripts/codex-launcher.sh            start Codex threads at one reasoning effort
tests/scenarios.py                   dry-run scenarios for the repair paths
```

Workflows compose with `include:`. Runs read the files through `--workflow-source`, so a caller pins them by this repository's commit.

## Running

Archon 0.14 or later, with Claude Code and Codex logged in.

```sh
# In the target checkout: install the Codagent skills the workflow names.
/path/to/agent-workflows/scripts/install-skills.sh /path/to/agent-skills .

archon workflow run codagent-implement-change \
  --cwd . --no-worktree \
  --workflow-source /path/to/agent-workflows \
  --config /path/to/agent-workflows/roles/baseline.yaml \
  --input change_name=<name> \
  --input change_dir=openspec/changes/<name> \
  --input change_label="OpenSpec change" \
  --input change_kind=openspec \
  --input artifact_validation_instruction="Run openspec validate <name>." \
  --input skip_validator=true \
  --input session_dir=/absolute/path/for/session/files
```

The role aliases `@lead`, `@crosscheck`, `@implementor` and `@tester` must be bound, by `--config` or the target's `.archon/config.yaml`. Each node names its role alias; the binding picks the provider, model and effort.

Start Codex threads at the Codex roles' effort. Archon starts each Codex thread at the effort in `~/.codex/config.toml` and sets the role's effort on the turn. When the two differ, Codex records a mid-session effort change, and the acceptance tester ends its turn right after planning. Write a launcher and point Archon at it:

```sh
/path/to/agent-workflows/scripts/codex-launcher.sh "$(command -v codex)" medium /path/to/codex-launcher
# Archon config (ARCHON_HOME/config.yaml):
#   assistants:
#     codex:
#       codexBinaryPath: /path/to/codex-launcher
```

Archon takes one Codex binary per run, so pick the effort most Codex roles share. With `roles/baseline.yaml` that is `medium` (implementor and tester), and only the crosscheck (`high`) still changes effort on its first turn.

The skills install into the target's `.agents/skills/` (Codex) and `.claude/skills/` (Claude) and are listed in `.git/info/exclude`. Codex nodes invoke skills by name (`$codagent-implement-change`), because Archon turns off Codex's automatic skill catalog. The Claude (lead) nodes in this port name no skills, and run with `settingSources: [project]` so the host's user-level Claude settings stay out.

The agent-evals and-scene suite runs this workflow with `run.sh --engine archon`.

## Tests

```sh
python3 tests/scenarios.py
```

Each scenario runs `archon workflow run --dry-run --exec-code` with stubbed agent responses in a scratch repository, so the shell checks really run. They cover each repair passing at once, recovering after a fix, running out of fixes, and reporting itself blocked; the implementor's blocked paths; and the acceptance rounds.

## Differences from Agent Runner

These are deliberate, and each can move an eval score or cost.

1. **No `call_agent`.** Where Runner's agents escalate a question to the lead, the ported prompts tell the agent to decide, record the decision in `implementor-decisions.md`, and list questions it would have escalated in `acceptance-assumptions.md` as its own rulings. `check-lead-decisions` is not ported.
2. **Repairs are unrolled.** Runner repeats a check-and-repair loop. Archon's `--dry-run` doesn't execute `until_bash`, so a `loop_group` repair couldn't be tested before a paid run. Each repair is instead a fixed chain: check, then for each allowed attempt a fix, a blocked check (failing the run on `REPAIR_BLOCKED`), and a re-check. Every fix is checked, and there are never more fixes than Runner allows.
3. **A repair forks its role's session.** In Runner a fix continues the role's named session, and later steps see it. Here a fix resumes a fork, and the role's main line continues from before the fix.
4. **No Agent Validator paths.** The workflow requires `skip_validator=true`.
5. **No `audit.log`.** Runner writes one and the tester's prompt names it. Archon has no equivalent, so the reference is removed rather than faked.
6. **Only the session report is saved as a response file.** Runner saves every agent's response under `session_dir/output/`. Here only `save-session-report` does, writing `output/session-report.out` for the acceptance tester. The files agents write themselves keep Runner's names, so the eval's evidence discovery and the ported prompts find them.
7. **Host instead of sandbox.** Archon runs agents on the host. Runner's eval runs in Docker.
8. **One starting effort for Codex threads.** Runner starts each Codex session at its role's effort. Archon starts them at one effort per run, set by `scripts/codex-launcher.sh`, and a role with a different effort switches on its first turn.
9. **The tester stops its own servers.** Runner's `codex exec` ends a session's commands when the turn ends. Archon waits for every command a Codex turn started, so a preview server left running held the first scored rep's tester open until Archon's 30-minute idle timeout failed it, and the retry started the round over. The tester's prompt adds one instruction: stop every server and long-running command before the final message.

Kept from Runner: the autonomy preamble ("You are running autonomously with no human in the loop..."). Runner puts it before every agent prompt that starts a session in an autonomous run, and the port does the same on every `context: fresh` node, through the `autonomy_preamble` input. Without it, the first paid trial's acceptance tester stopped after reading the spec and reported NOT_READY in every round.
