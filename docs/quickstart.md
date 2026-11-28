---
title: Quickstart
group: Getting Started
order: 2
description: Install both plugins, define a small change, implement it with Archon, and review the result.
---

# Quickstart

This page takes one small change from idea to merged pull request. It assumes you have a git repository with an `openspec/` folder, a GitHub remote you can push to, and Claude Code or Codex signed in. [Setup](setup.md) lists every requirement and explains the Archon step.

## 1. Clone the repository and install the plugins

Archon reads the workflows from a clone of this repository, so clone it first:

```bash
git clone https://github.com/Codagent-AI/agent-workflows.git
```

On Claude Code, add the marketplace and install both plugins:

```text
/plugin marketplace add Codagent-AI/agent-workflows
/plugin install define-openspec-change@agent-workflows
/plugin install codagent-archon@agent-workflows
```

On Codex, from the clone:

```bash
codex plugin marketplace add /path/to/agent-workflows
codex plugin add define-openspec-change@agent-workflows
codex plugin add codagent-archon@agent-workflows
```

## 2. Set up Archon

Implementation runs on Archon, run from a fork that the pack needs. Follow [Setup](setup.md#install-archon) to install it, run `archon setup`, and add Archon's `archon-cli` skill to your repository.

## 3. Define a small change

Open your session in the repository and start a define. Name the change, and say what you want:

| CLI | Command |
|---|---|
| Claude Code | `/define-openspec-change:define add-dark-mode a dark theme toggle in settings` |
| Codex | `$define add-dark-mode a dark theme toggle in settings` |

The first time, the agent offers to set up the crosscheck, which is the review by agents from other vendors. Say yes. It writes `~/.agent-workflows/config.yaml`. See [Crosschecks](crosschecks.md).

Then work through the five steps with the agent: proposal, specs, design, test plan and approach review. The agent can't move on until the step's file is written. At the end the plugin validates the change and commits `openspec/changes/add-dark-mode/`. [Defining a change](defining-a-change.md) has the details.

Run the define on a branch, or on the default branch. Either way the change must be committed where Archon can find it. On a branch, the define also pushes it and opens a pull request.

## 4. Implement it with Archon

In the same repository, ask for the change to be implemented:

| CLI | Command |
|---|---|
| Claude Code | `/codagent-archon:implement-change add-dark-mode` |
| Codex | `$implement-change add-dark-mode` |

The skill checks where the change is, launches the run, waits without using the model, and tells you when it stops. The run builds the change on its own branch in an Archon worktree and opens a draft pull request. It can take half an hour or more. You can define your next change in the meantime. See [Implementing a change](implementing-a-change.md).

## 5. Review and merge

When the run finishes its work, it publishes a review page and waits. The skill gives you the page's address. Open it, answer the questions on each concern, and choose:

- **Send feedback** runs another round. The agents address your answers and publish a new page.
- **Merge** merges the pull request at the head the page showed.

[Reviewing a run](reviewing-a-run.md) explains the page, its tiers and its buttons.

## If something stops

A run that hits a problem stops and tells you. [Troubleshooting](troubleshooting.md) covers the common ones.
