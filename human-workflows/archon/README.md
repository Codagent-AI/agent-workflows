# codagent-archon

A Claude Code and Codex plugin for running the Codagent pack's Archon workflows from your own session. You ask your agent to implement an approved OpenSpec change; it launches the pack's `codagent-implement-change` workflow on Archon, waits while it runs, investigates and resumes a run that fails, and reports the pull request. A run doesn't pause mid-build to ask you questions. If it hits a blocker only a person can resolve, it stops, and the plugin brings you the question. Answering usually means updating the change and starting a new run. When the build finishes, the run waits on its review page for your feedback or Merge.

## Requirements

- Archon, set up as the [Setup page](../../docs/setup.md#set-up-archon) says: `archon setup`, then Archon's own `archon-cli` skill installed with `archon skill add`. This plugin relies on that skill for general Archon use and does not repeat it.
- What the pack needs to run, listed in [Setup](../../docs/setup.md#requirements): the providers your role bindings name, signed in, the forge plugin for your git host, and the `openspec` CLI.
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

The change must be committed under `openspec/changes/<name>/` in the repository you run it from. The run builds it on its own branch in an Archon worktree, opens a pull request, and never merges unless you choose Merge on the review page.

## Documentation

- [Implementing a change](../../docs/implementing-a-change.md)
- [Reviewing a run](../../docs/reviewing-a-run.md)
- [Setup](../../docs/setup.md)

Rules for changing this plugin are in [AGENTS.md](AGENTS.md).
