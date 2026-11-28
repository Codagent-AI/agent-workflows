# define-openspec-change

A Claude Code and Codex plugin that defines an OpenSpec change with you, in your own session. It takes the change through five steps: proposal, specs, design, test-plan, and approach-review. Agents on other vendors' CLIs review the proposal and the finished approach. At the end the plugin validates the change and commits its documents.

## Requirements

- macOS or Linux.
- Node.js 26 or later and the `openspec` CLI on `PATH`.
- A git repository with an `openspec/` folder. To finish on a branch other than the default branch, `gh` must be signed in.
- `claude`, `codex`, or both, signed in, and acpx 0.23 or later for the crosscheck.

[Setup](../../docs/setup.md#requirements) has the details.

## Install

From a clone of this repository:

```sh
# Claude Code
claude plugin marketplace add /path/to/agent-workflows
claude plugin install define-openspec-change@agent-workflows

# Codex
codex plugin marketplace add /path/to/agent-workflows
codex plugin add define-openspec-change@agent-workflows
```

## Use

| CLI | Start or resume a define |
|---|---|
| Claude Code | `/define-openspec-change:define [change-name] [what you want]` |
| Codex | `$define [change-name] [what you want]` |

The change name is optional. To pick up a define in a new session, on either CLI, start it again with the same name.

## Documentation

- [Defining a change](../../docs/defining-a-change.md): the steps, resuming, and how a define finishes
- [Crosschecks](../../docs/crosschecks.md): the reviewers, and running one at any time
- [Roles and settings](../../docs/roles-and-settings.md#the-crosscheck-config): the crosscheck config file
- [Setup](../../docs/setup.md)
- [Troubleshooting](../../docs/troubleshooting.md)

Rules for changing this plugin are in [AGENTS.md](AGENTS.md).
