---
name: setup
description: Creates or changes ~/.agent-workflows/config.yaml, which sets the CLI, model, and effort of the crosscheck agent that reviews a define-openspec-change definition. Use when next_step or call_agent says the crosscheck is not configured or cannot run, or when the user asks to set up, configure, or change the crosscheck agent.
---

# Set up the crosscheck agent

define-openspec-change reads the crosscheck agent from the `human-workflows.crosscheck` list in `~/.agent-workflows/config.yaml`:

```yaml
human-workflows:
  crosscheck:
    - cli: codex
      model: gpt-6-astra
      effort: high
    - cli: claude
      model: opus
      effort: high
factory-workflows: {}
```

The file has one section per top-level folder of the repo. This plugin reads only
`human-workflows.crosscheck`. `factory-workflows` is for the factory workflows and nothing reads it yet.
There is one entry per CLI, and `cli` is `claude` or `codex`. When a crosscheck runs, the plugin uses
the entry for the CLI that is not leading the session, if that CLI is listed and installed. Otherwise
it uses the lead's own entry, so the review runs on the same CLI as the lead, in a separate read-only
session. `model` and `effort` are optional. Without them the child uses its CLI's default model and
`high` effort.

1. Find which CLIs are installed. Run `command -v claude` and `command -v codex`. If neither is found,
   tell the user that define-openspec-change needs Claude Code or Codex on the PATH, and stop.
2. If `~/.agent-workflows/config.yaml` exists, read it. Show the user its current `human-workflows.crosscheck`
   list. You will change only that list. Leave every other key as it is, including `factory-workflows`
   and anything under `human-workflows` besides `crosscheck`. If the file has a top-level `crosscheck`
   list instead, that is the old place for it and the plugin refuses it. Show those entries as the
   user's current settings, offer them as the starting point, and move them under
   `human-workflows.crosscheck` once the user confirms, removing the top-level list.
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
   list under `human-workflows.crosscheck`, in the shape shown above. If the file already exists, edit
   only that list and keep everything else in the file exactly as it was. If it does not, use the
   example above as the shape of the file, with only the confirmed entries and `factory-workflows: {}`
   as shown. Do not invent settings for `factory-workflows`. If `human-workflows` exists but is not a
   mapping, tell the user, and replace it only after they agree.
   Put nothing else in the entries, and no secrets in the file. Show the user what you wrote.
6. If you came here because `next_step` refused to start, call `next_step` again with the same
   `change_name` and `start: true`. If `call_agent` refused, call it again with the same prompt.
