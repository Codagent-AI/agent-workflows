---
title: Crosschecks
group: Guides
order: 2
description: How agents from other vendors review your proposal and approach, how to run one at any time, and what keeps a reviewer from changing your files.
---

# Crosschecks

A crosscheck is a review by one or more other agents. Each reviewer reads your repository independently and reports what it finds. Your own agent then checks every finding against the source before it brings the result to you.

A define runs a crosscheck twice: on the proposal, and on the whole approach (proposal, specs, design and test plan) at the end. You can also run one at any time, on anything.

Crosschecks run through acpx, a command-line client for the Agent Client Protocol that starts other agents' CLIs with a chosen model and permission policy. You need acpx 0.23 or later on `PATH`. Install it with `npm install -g acpx@latest`. See [Setup](setup.md#requirements).

## Which reviewers run

Reviewers come from `~/.agent-workflows/config.yaml`. See [Roles and settings](roles-and-settings.md#the-crosscheck-config).

- Every configured reviewer on a CLI other than your session's CLI runs, all at the same time.
- If no reviewer is on another CLI, your own CLI's entry runs, in a separate session.
- If the plugin can't tell which CLI you are using, every available reviewer runs.

An entry for `claude`, `codex` or `agy` is available when that CLI is on `PATH`. An entry for any other agent counts as available. If acpx can't start it, that reviewer fails with acpx's message and the others still finish.

A crosscheck is `succeeded` only when every reviewer answered. If one fails, the crosscheck is `failed`, and the result still holds the failure and the other reviewers' answers.

## Run one at any time

Start a crosscheck yourself, with or without a define in progress:

| CLI | Command |
|---|---|
| Claude Code | `/define-openspec-change:crosscheck` |
| Codex | `$crosscheck` |

Name the code, diff, document or plan you want reviewed. Your agent writes a complete prompt, runs one crosscheck, and reports one combined result with every failed reviewer and every changed path. Only you start this skill. The agent doesn't start it on its own.

Name a define in progress when you want the result recorded with it. A name that is not a define in progress is refused.

## How a crosscheck runs

The plugin's tools do the work:

| Tool | What it does |
|---|---|
| `crosscheck` | Starts every chosen reviewer at once. It returns when all have finished, or after about 50 seconds with an id to wait on. |
| `get_crosscheck` | Waits another 50 seconds or so and returns the result. |
| `cancel_crosscheck` | Stops every running reviewer. |

Each reviewer gets exactly the prompt your agent wrote, on its standard input, with no text added. Your session's variables are removed from the reviewer's environment.

Rules:

- One crosscheck runs at a time. A second call is refused and names the running one.
- A crosscheck is refused while `next_step` runs, and `next_step` is refused while a crosscheck runs.
- A crosscheck is stopped after 60 minutes. A reviewer stopped for the limit shows as failed with the code `timeout`.
- A cancelled or timed-out reviewer that ignores termination is killed. Reviewers don't outlive the plugin's server.
- With no usable config, or without acpx, the call is refused with the code `crosscheck_not_configured` and points to the setup skill.

The result shows each reviewer's CLI, model, effort, status and time. Effort is passed to the agent's own setting for Claude, Codex and agy. For another agent it is not passed, and the result says so. A reviewer's answer is capped at 200,000 characters.

## What keeps a reviewer from writing

Reviewers need to read, search and run commands, so acpx approves every permission request. Two things keep them read-only in practice:

- The prompt tells them to change nothing.
- The plugin fingerprints your working tree before the first reviewer starts and after the last one ends. The result's `working_tree` is `unchanged`, `changed` or `unknown`, and a change lists the paths.

The check reports a change after it happens. It can't restore an uncommitted file. It does not see a push or a write outside the repository. Treat the prompt as the control, and read any changed path the result lists.

## Where the results go

When a crosscheck names a define, the define's state file records it: the step, the times, the working-tree result, and each reviewer's CLI, model, effort and status. Logs go to `$TMPDIR/define-openspec-change-<uid>/`, in a folder only you can read.

## Limits and cautions

- Run crosschecks only in repositories you trust. acpx reads a repository's `.acpxrc.json`, which can replace a reviewer's command or add MCP servers to it. The plugin honors it, as it does your own `~/.acpx/config.json`.
- acpx is alpha. Its Claude and Codex adapters download through `npx` the first time they run, so the first crosscheck is slower and needs network access.
- A reviewer's model must be one the agent offers. Otherwise that reviewer fails with acpx's message.
- Codex passes the plugin's server only some of your environment variables. A new agent's credential variables must be added to the plugin's `.codex-mcp.json`. See [Troubleshooting](troubleshooting.md#codex).
