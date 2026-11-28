# define-openspec-change

A Claude Code and Codex plugin that defines an OpenSpec change with you, in your own session. It takes the change through five steps: proposal, specs, design, test-plan, and approach-review. A batch of independent reviewers checks the proposal and the finished approach. At the end the plugin validates the change and commits its documents.

## Requirements

- macOS or Linux.
- Node.js 22 or later and the `openspec` CLI on `PATH`.
- A git repository with an `openspec/` folder. To finish on a branch other than the default branch, `gh` must be signed in.
- acpx 0.23 or later on `PATH` and at least one configured reviewer. Sign in to the agents you use, such as `claude`, `codex`, and `agy`.

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

The change name is optional. Without one, the agent names the change from what you want, without asking. A name uses lowercase letters, digits, and hyphens, for example `add-dark-mode`.

The agent works through each step with you, and can't move on until the step's file is written. In the proposal and approach-review steps, the configured reviewers run together. They receive instructions to change nothing. acpx grants their permission requests, and the plugin reports any working-tree changes it detects. Your agent checks each finding before bringing it to you.

After approach-review, the define finishes:

- It validates the change and commits only `openspec/changes/<name>/`. Your other work is left as it was.
- On the default branch it stops there, and you push when ready.
- On any other branch it also pushes the branch and opens a pull request.

To pick up a define in a new session, on either CLI, start it again with the same name.

## Standalone crosschecks

Use `/define-openspec-change:crosscheck` in Claude Code or `$crosscheck` in Codex. Name the code, diff, document, or plan you want reviewed. The lead runs one batch and reports checked findings, reviewer failures and changed paths. A define is optional.

## Configuration

The first time you start a define, the agent offers to set up the reviewer with you and writes `~/.agent-workflows/config.yaml`:

```yaml
human-workflows:
  crosscheck:
    - cli: codex
      model: gpt-6-astra
      effort: high
    - cli: claude
      model: opus
      effort: high
    - cli: agy
      model: gemini-4-neon
      effort: high
```

`model` and `effort` are optional. The agent supplies the default model, and effort defaults to `high` for Claude, Codex, and agy. Any acpx agent name is allowed. All available non-lead entries run together, with the lead's own entry as a fallback. When the lead is unknown, all available entries run. To change the file later, run the `setup` skill: `/define-openspec-change:setup`, or `$setup` in Codex.

Claude Code asks before each call to the plugin's tools. To stop the prompts, add `"mcp__plugin_define-openspec-change_define"` to `permissions.allow` in your Claude Code settings.

Logs are in `$TMPDIR/define-openspec-change-<uid>/`.

## How crosschecks run

The server starts one `acpx exec` per reviewer, sends the lead's prompt on stdin and reads ACP events for the final answers. Claude and Codex use acpx's built-in profiles. The agy entry uses the local `agy acp` command. acpx honors its user and repository config, with command-line options supplying the working folder, model, timeout and approval policy.

Run crosschecks only in repositories and checkouts you trust. A repository's `.acpxrc.json` can replace a reviewer command or add MCP servers. acpx can launch those commands with access to the reviewer's environment before the reviewer reads the prompt.

The MCP tools `crosscheck`, `get_crosscheck`, and `cancel_crosscheck` supervise the batch. Only one batch runs at a time, and `next_step` waits for the batch to finish or be cancelled. When a call names a define, its result is recorded with that define's current step. Earlier state files continue to load.
