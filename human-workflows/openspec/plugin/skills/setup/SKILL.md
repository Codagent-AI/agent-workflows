---
name: setup
description: Creates or changes ~/.agent-workflows/config.yaml, which sets the CLI, model, and effort of the crosscheck agent that reviews a define-openspec-change definition. Use when next_step or call_agent says the crosscheck is not configured or cannot run, or when the user asks to set up, configure, or change the crosscheck agent.
---

# Set up the crosscheck agent

define-openspec-change reads the crosscheck agent from `~/.agent-workflows/config.yaml`:

```yaml
crosscheck:
  - cli: codex
    model: gpt-6-astra
    effort: high
  - cli: claude
    model: opus
    effort: high
```

There is one entry per CLI, and `cli` is `claude` or `codex`. When a crosscheck runs, the plugin uses
the entry for the CLI that is not leading the session, if that CLI is listed and installed. Otherwise
it uses the lead's own entry, so the review runs on the same CLI as the lead, in a separate read-only
session. `model` and `effort` are optional. Without them the child uses its CLI's default model and
`high` effort.

1. Find which CLIs are installed. Run `command -v claude` and `command -v codex`. If neither is found,
   tell the user that define-openspec-change needs Claude Code or Codex on the PATH, and stop.
2. If `~/.agent-workflows/config.yaml` exists, read it. Show the user its current `crosscheck` list,
   and keep every other key in the file as it is.
3. Recommend one entry per installed CLI:

   | CLI | Model | Effort |
   | --- | --- | --- |
   | `codex` | `gpt-6-astra` | `high` |
   | `claude` | `opus` | `high` |

   - With both installed, recommend both entries, so the review always runs on the other vendor.
   - With only one installed, recommend only its entry. Say that the crosscheck will then run on the
     same CLI as the lead, so it will not be a review from another vendor.
   - If an entry already exists for a CLI, show it beside the recommendation and let the user keep it.
4. Ask the user to confirm the entries or change a CLI's model or effort. Follow the
   define-openspec-change:ask-questions skill. Do not write the file until the user confirms.
5. Create `~/.agent-workflows/` if it is missing, then write `config.yaml` with the confirmed
   `crosscheck` list in the shape shown above. Put nothing else in the entries, and no secrets in the
   file. Show the user what you wrote.
6. If you came here because `next_step` refused to start, call `next_step` again with the same
   `change_name` and `start: true`. If `call_agent` refused, call it again with the same prompt.
