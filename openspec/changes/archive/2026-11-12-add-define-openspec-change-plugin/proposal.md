# Proposal

## Why

Defining an OpenSpec change well takes several documents written in order: a proposal, specs, a design, and a test plan. Left to the model, the order and the checks drift. Steps get skipped, files stay empty, and a review is forgotten. People also want an independent review from the other vendor's agent. This change adds a plugin that fixes the order in code, checks each step's file, and runs the review on a second CLI.

## What Changes

- Add `define-openspec-change`, a plugin for Claude Code and Codex that walks a person and an agent through five steps in one conversation: proposal, specs, design, test-plan, and approach-review.
- Add a bundled tool server with `next_step`, `call_agent`, `get_agent_call`, and `cancel_agent_call`. `next_step` starts or resumes a define, checks the current step's file, and returns the next step's instructions.
- Keep the step order and prompts in `plugin/workflow.yaml`, not in the server.
- Save progress in a state file inside the change folder, so a define resumes in a new session on either CLI.
- Run a read-only crosscheck review on the other vendor's CLI during proposal and approach-review.
- Read the crosscheck settings from `~/.agent-workflows/config.yaml`, and add a `setup` skill that writes them.
- After the last step, validate the change, commit only the change folder, and on a non-default branch push and open a pull request.
- Ship skills for each step, two review instruction files, manifests for both CLIs, and a committed bundle.

Where the skills and prompts were copied from is recorded in `plugin/PROVENANCE.md`.

## Capabilities

### New Capabilities

- `define-step-sequencing`: starting, resuming, and advancing a define through the ordered steps, with the saved state and the artifact check for each step.
- `define-finish`: validating the finished change and committing, pushing, and opening a pull request.
- `crosscheck-review`: the crosscheck agent call, its configuration, its read-only limits, and its lifecycle.
- `plugin-packaging`: installing, starting, and running the plugin on both CLIs, and the entry and setup skills.

### Modified Capabilities

None. The repository has no specs yet.

## Impact

- New code under `human-workflows/openspec/`: `plugin/` (the installable root), `server/` (TypeScript source, tests, build), and a README.
- Requires Node.js 26, the `openspec` CLI, git, and `claude`, `codex`, or both. `gh` is needed to open a pull request.
- Writes `~/.agent-workflows/config.yaml` (through the `setup` skill only) and logs under the system temp folder.
- Creates `openspec/changes/<name>/` in the user's repository and commits it.
- Out of scope: Windows, task planning, implementing the change, and any workflow that runs without a person.
