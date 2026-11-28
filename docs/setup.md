---
title: Setup
group: Getting Started
order: 3
description: What each part needs, how to install Archon and its fork, and how Archon reads the workflow pack.
---

# Setup

Each part has its own requirements. You need the first three rows to define a change. You need all of them to implement one.

## Requirements

| Part | Needs |
|---|---|
| Define (`define-openspec-change`) | macOS or Linux. Node.js 26 or later. The `openspec` CLI on `PATH` (tested with 1.17.0). A git repository with an `openspec/` folder. Claude Code or Codex, signed in. |
| Crosschecks | `acpx` 0.23 or later on `PATH`. At least one reviewer's CLI installed and signed in: `claude`, `codex`, `agy`, or another agent acpx can start. |
| Finishing a define on a branch | `gh`, signed in. It opens the pull request. |
| The `codagent-archon` plugin | Archon, set up as below. A clone of this repository. `jq` on `PATH`. |
| The pack (the run itself) | Archon from the fork. `bun`. The providers your role bindings name, signed in. `git` with push access to the target repository. The Archon forge plugin for your git host. The `openspec` CLI. `gh`, for pull request comments. |
| Size count on the review page (optional) | `cloc` on the host that runs the workflow. Without it the page says the count is unavailable. |

You don't need both Claude Code and Codex. The crosscheck runs every configured reviewer that is not on your session's CLI, so a second signed-in CLI gives you a review from another vendor.

## Install Archon

The pack needs [Archon](https://github.com/coleam00/Archon) and two features that upstream Archon does not have yet. They are in the Codagent-AI fork, on its `dev` branch.

- **Named resume.** The implementor's steps continue one session in place, so each step sees the earlier steps and reads the provider's prompt cache. Upstream Archon forks the session instead. On upstream nothing fails, but each resumed step sees less and costs more.
- **Answers from the review page.** The review page sends your feedback or your merge to the run's wait. The fork lets only the pages the wait names reach the wait's attention and answer addresses, so no other HTML in the run's files can answer or merge. Without it the page can't send. It offers the Archon command to copy instead.

Run the fork from source with bun. Clone it, switch to `dev`, install, and put a small wrapper on your `PATH`:

```bash
git clone https://github.com/Codagent-AI/Archon.git
git -C Archon switch dev
bun install --cwd Archon
```

The wrapper is a script named `archon`, in a folder on your `PATH`, made executable:

```bash
#!/bin/sh
exec bun /path/to/Archon/packages/cli/src/cli.ts "$@"
```

Everything in these docs that says `archon` means this command. A source checkout runs the providers and the GitHub forge plugin from source, so you install nothing more for them.

Update the fork by pulling `dev`. Pin the commit you run if you need runs to be repeatable.

## Set up Archon

1. Run `archon setup`. It sets up the providers your role bindings name, with their logins, and offers to install Archon's skill in a project.
2. Install Archon's `archon-cli` skill in each repository you run the pack against. The pack's workflows don't use it, but it lets your coding agent launch, watch, answer and resume their runs, and the `codagent-archon` plugin relies on it for general Archon use. `archon skill add /path/to/target` installs it for Claude Code (`.claude/skills/`) and Codex (`.agents/skills/`). `archon setup` does the same for the one project you name. The skill is a copy of the one your Archon ships, so run `archon skill add` again after you update Archon.
3. Bind the role aliases the pack uses. See [Roles and settings](roles-and-settings.md#roles).

## The forge plugin

The pack reads and writes pull requests through Archon's forge plugin for your git host, run as `archon forge`. Before any agent spends, the run checks that the plugin and its credential are there, and refuses to start if they are not.

- From a source checkout of Archon, and in Docker, the GitHub forge plugin runs from source with your `gh` login. Nothing to install.
- With a release binary, install it once:

```bash
archon plugin add coleam00/Archon/plugins/forge-github
```

The credential is `GH_TOKEN` or the `gh` login.

## How the pack is read

You don't install the pack. Archon reads it from a folder you name with `--workflow-source`:

```bash
archon workflow run codagent-implement-change \
  --cwd /path/to/target \
  --workflow-source /path/to/agent-workflows/factory-workflows/archon \
  --input change_name=<name>
```

The folder is read as it is on disk, edits included, and Archon freezes it when the run starts. A resume refuses a pack that changed since. So a clone on `main` gives you the released workflows, and a clone on another branch gives you that branch's. The `codagent-archon` plugin runs this command for you, against the clone you point it at.

## Install the plugins

[Quickstart](quickstart.md#1-clone-the-repository-and-install-the-plugins) has the commands for Claude Code and Codex. Both plugins come from this repository's marketplace.

## Permission prompts

Claude Code asks before each call to the define plugin's tools. [Troubleshooting](troubleshooting.md#claude-code-asks-before-every-tool-call) shows how to stop the prompts.
