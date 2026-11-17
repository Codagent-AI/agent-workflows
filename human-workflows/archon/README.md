# codagent-archon

A Claude Code and Codex plugin for running the Codagent pack's Archon workflows from your own session. You ask your agent to implement an approved OpenSpec change; it launches the pack's `codagent-implement-change` workflow on Archon, waits while it runs, brings you the questions only a person can answer, investigates and resumes a run that fails, and reports the pull request.

## Requirements

- Archon, set up as the Setup section of the [pack's README](../../factory-workflows/archon/README.md#setup) says: `archon setup`, then Archon's own `archon-cli` skill installed with `archon skill add`. This plugin relies on that skill for general Archon use and does not repeat it.
- What the pack needs to run, in its README's Running section: the providers your role bindings name, signed in, the forge plugin for your git host, and the `openspec` CLI.
- A clone of this repository, which holds the pack the run reads.
- `jq` on `PATH`.

## Install

From a clone of this repository:

```sh
# Claude Code
claude plugin marketplace add /path/to/agent-workflows
claude plugin install codagent-archon@agent-workflows

# Codex
codex plugin marketplace add /path/to/agent-workflows
codex plugin add codagent-archon@agent-workflows
```

## Use

| CLI | Implement a change |
|---|---|
| Claude Code | `/codagent-archon:implement-change <change-name>`, or ask to implement the change with Archon |
| Codex | `$implement-change <change-name>`, or ask to implement the change with Archon |

The change must be committed under `openspec/changes/<name>/` in the repository you run it from. The run builds it on its own branch in an Archon worktree, opens a pull request, and never merges.
