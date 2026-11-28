---
title: Troubleshooting
group: Operations
order: 1
description: Fixes for permission prompts, Codex differences, crosschecks that fail, runs that stall, and review page answers that don't continue.
---

# Troubleshooting

## Defining

### Claude Code asks before every tool call

Claude Code asks before each call to the define plugin's tools. To stop the prompts, add this to `permissions.allow` in your Claude Code settings:

```json
"mcp__plugin_define-openspec-change_define"
```

Codex asks under your own approval settings, and the plugin pre-approves nothing.

### The define won't start

`next_step` refuses to start in these cases, and says why:

- The name breaks the rule: lowercase letters, digits and hyphens, starting with a letter or digit.
- `openspec/changes/<name>/` already exists with no state file. Pick another name.
- The session isn't in a git repository.
- The crosscheck isn't set up. See below.
- The define is already complete.

### The crosscheck says it isn't configured

A refusal with the code `crosscheck_not_configured` means the config is missing or invalid, no reviewer is available, or acpx 0.23 or later isn't on `PATH`. Run the `setup` skill (`/define-openspec-change:setup`, or `$setup` in Codex). It checks acpx, recommends one entry per installed CLI, and writes nothing until you confirm.

### A reviewer failed

The result names each failed reviewer and its error. Common causes:

- The CLI isn't signed in.
- The entry's `model` isn't one the agent offers. acpx's message says so. Remove `model` to use the default.
- The first run of a Claude or Codex reviewer downloads its adapter through `npx`. It needs network access and can take a while.
- The crosscheck ran past 60 minutes. The reviewer shows `timeout`.

### A reviewer changed a file

The result's `working_tree` is `changed` and lists the paths. Only the prompt stops a reviewer from writing. Look at the diff, and restore what you don't want. An uncommitted file the reviewer overwrote can't be recovered by the plugin.

### Codex

Codex differs from Claude Code in four ways:

- Codex doesn't expand a plugin-root variable in a plugin's server config, so the plugin has its own `.codex-mcp.json`, which starts the server in the plugin folder.
- The server needs your session's folder. Claude Code sets it once. On Codex the server reads it on every call, from the call's metadata.
- Codex passes the server only a few variables, such as `HOME` and `PATH`. The plugin forwards the ones it needs: the child CLIs' credentials and settings, the `gh` and git variables, and `DEFINE_OPENSPEC_CHANGE_WAIT_SECONDS`. If a reviewer for a new agent can't sign in under Codex, its credential variables aren't on that list.
- On Codex the agent can start a define itself when you ask it to define a change. On Claude Code only you can.

### Logs

The plugin writes private logs under `$TMPDIR/define-openspec-change-<uid>/`, outside your repository. Each crosscheck keeps each reviewer's prompt, acpx command, output and answer there.

## Implementing

### An alias silently uses the wrong model

An alias with no binding falls back to its size's default model, with no warning. Check that `@implementor`, `@tester` and `@reviewer` are bound where Archon reads them. See [Roles and settings](roles-and-settings.md#roles).

### A run didn't see my pack settings

Archon reads `.archon/packs/codagent.yaml` from the run's checkout. An isolated run sees the file only if it is committed or listed under `worktree.copyFiles`. Commit it, or pass the setting with `--input name=value`.

### Stock Archon behaves differently

On upstream Archon nothing fails, but the implementor's steps see less and cost more, and the review page can't send. Use the Codagent-AI fork. See [Setup](setup.md#install-archon).

### A run is held open by a leftover server

Archon waits for every command a Codex turn started. A preview server the tester leaves running holds its turn open, and a run can then sit for hours. The tester's prompt tells it to stop its servers. If a run has gone quiet, look for a server process in the run's worktree, stop it, and the turn finishes. The `codagent-archon` skill's wait stops after 30 minutes of a tool call with no output.

Don't stop processes another session started.

### A run stopped with `owner_lost`

The process that owned the run is gone. Check that the process is really gone before you do anything. Then resume, or abandon the run on purpose. Archon's `archon-cli` skill covers resuming, cancelling and abandoning.

### A run stopped with `REPAIR_BLOCKED` or `implementation-blocked.md`

A person has to settle something. Read the reason, update the change, and start a new run. See [Implementing a change](implementing-a-change.md#what-to-do-next).

### A pack fix doesn't reach my run

Archon freezes the workflow, commands and scripts when a run starts, and a resume refuses a changed copy. A fix to the pack reaches only a new run. A fix to Archon itself reaches a resume when you run Archon from a source checkout. A fix to code in the run's worktree reaches a resume.

### Where to look first

- `archon workflow get <run-id> --cwd <checkout> --json --verbose` for the run's state, nodes and reason.
- The run's artifacts folder. See [Workflow reference](workflow-reference.md#files-a-run-writes).
- The log path the launch printed.
- Archon's web UI.

## Reviewing

### A review page answer does not continue the run

Archon stores your answer, but a run goes on only on a host that is running. Start `archon serve`, or run `archon workflow wake`. If the page says it can't send, copy the text it offers and answer from Archon's CLI or UI. The page can't send when it is opened as a file, when the Archon server needs a web login without a configured web UI origin, or on Archon without the fork's page answers.

### The page says the run isn't waiting for it

You sent from an earlier round's page. Open the latest one at the fixed address. See [Reviewing a run](reviewing-a-run.md#find-the-page).

### Merge is missing

Merge shows only when the archive and finalize passed. Read the High concern that says which failed.

### The size count is unavailable

Install `cloc` on the host that runs the workflow. The rest of the page is unaffected.
