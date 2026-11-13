# define-openspec-change

A Claude Code and Codex plugin that defines an OpenSpec change with you, in your own session. It takes the change through five steps: proposal, specs, design, test-plan, and approach-review. An agent on the other vendor's CLI reviews the proposal and the finished approach. At the end the plugin validates the change and commits its documents.

## Requirements

- macOS or Linux.
- Node.js 26 or later and the `openspec` CLI on `PATH`.
- A git repository with an `openspec/` folder. To finish on a branch other than the default branch, `gh` must be signed in.
- `claude`, `codex`, or both, signed in. With both, the review runs on the CLI you are not using.

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
| Claude Code | `/define-openspec-change:define <change-name> [what you want]` |
| Codex | `$define <change-name> [what you want]` |

The change name uses lowercase letters, digits, and hyphens, for example `add-dark-mode`.

The agent works through each step with you, and can't move on until the step's file is written. In the proposal and approach-review steps, a second agent reviews the work. It can read your repository but can't change it, and your agent checks each finding before bringing it to you.

After approach-review, the define finishes:

- It validates the change and commits only `openspec/changes/<name>/`. Your other work is left as it was.
- On the default branch it stops there, and you push when ready.
- On any other branch it also pushes the branch and opens a pull request.

To pick up a define in a new session, on either CLI, start it again with the same name.

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
```

`model` and `effort` are optional. Without them the reviewer uses its CLI's default model at high effort. To change the file later, run the `setup` skill: `/define-openspec-change:setup`, or `$setup` in Codex.

Claude Code asks before each call to the plugin's tools. To stop the prompts, add `"mcp__plugin_define-openspec-change_define"` to `permissions.allow` in your Claude Code settings.

Logs are in `$TMPDIR/define-openspec-change-<uid>/`.
