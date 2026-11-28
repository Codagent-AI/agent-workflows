---
title: Roles and settings
group: Configuration
order: 1
description: Bind the pack's role aliases to providers and models, set the pack's settings in three layers, and configure the crosscheck reviewers.
---

# Roles and settings

Three things are configured, in three places.

| What | Where |
|---|---|
| Which provider, model and effort each agent role uses | Archon's config |
| How a run behaves: rounds, review, waits | Pack settings |
| Which agents review a define | `~/.agent-workflows/config.yaml` |

## Roles

Each agent step in the pack names a role alias and a size fallback. It never names a provider, model or effort. You bind the aliases, so you can change models without changing a workflow.

| Alias | Does | Fallback |
|---|---|---|
| `@implementor` | Writes the checklist, builds the change, fixes review findings, acceptance findings, CI failures and your feedback, and writes the pull request description | `large` |
| `@tester` | Judges completion, and tests the change as a user in each acceptance round | `medium` |
| `@reviewer` | Audits the implementation against the definition, reviews the code, and ranks what needs your call | `large` for the audit, `medium` for the rest |

The pack ships no bindings. Bind the aliases in one of these, which Archon reads from the checkout you launch with (`--cwd`), not from the pack:

- the target repository's `.archon/config.yaml`;
- `~/.archon/config.yaml`;
- a file passed with `--config`;
- one alias per run, with `--model '@tester=<provider>/<model>'`.

```yaml
aliases:
  '@reviewer': { provider: claude, model: <model>, effort: high }
  '@implementor': { provider: codex, model: <model>, effort: medium }
  '@tester': { provider: codex, model: <model>, effort: medium }
```

An alias with no binding silently falls back to its size's default model, with no warning. Check that all three resolve before a run. The `codagent-archon` skill checks this at launch.

### The effort caveat

Some Archon releases don't start a Codex thread at its node's reasoning effort. They start it at the effort in `~/.codex/config.toml` and change effort on the first turn. A Codex tester that changes effort mid-session can end its turn right after planning. On such a release, keep your Codex roles' effort equal to `~/.codex/config.toml`. The fix is in the Codagent-AI fork and on upstream `dev`, not in release 0.14.0.

## Pack settings

A pack setting is a constant of a run. The defaults suit an OpenSpec repository. The only input a launch must give is `change_name`.

| Setting | Default | Meaning |
|---|---|---|
| `review_strategy` | `builtin` | `builtin` reviews before the draft pull request and after each acceptance fix. `none` turns all review off. |
| `acceptance_rounds` | `3` | Most acceptance rounds, from 1 to 10. A larger value is refused. |
| `acceptance_fix_scope` | Resolve every high-confidence finding you can, including implementation, CI, pull request state, tooling, setup and environmental problems | Which findings the implementor resolves in each acceptance fix. |
| `review_wait` | `true` | Wait at the review page for feedback or a merge. `false` ends the run after publishing, and the page shows no buttons. |
| `archon_url` | empty | Your Archon server's address. The pull request description uses it for review page links. |
| `stop_after` | `finish` | `finish` runs everything through the review page. `acceptance` ends the run after the acceptance rounds and the recheck, with the pull request a draft and the change unarchived. |

Code review adds agent time and cost. Set `review_strategy: none` to turn it off.

### Three layers

A value comes from the first of these that sets it:

1. **The run:** `--input name=value`.
2. **The project:** `.archon/packs/codagent.yaml`, under `settings:`.
3. **The pack's defaults:** `.pack/pack.yaml` in the pack.

```yaml
settings:
  acceptance_rounds: 5
  review_strategy: builtin
```

An unknown key, or a value of the wrong type or outside its choices, refuses the run before any node runs. A run override reaches the blocks the run includes.

### The worktree caveat

Archon reads `.archon/packs/codagent.yaml` from the run's own checkout. An isolated run, in a worktree, sees the file only if it is committed, or listed under `worktree.copyFiles` in Archon's config. A file you edited but didn't commit is not there.

## The crosscheck config

`~/.agent-workflows/config.yaml` lists the reviewers a define's crosscheck uses. The first define offers to write it with you. To change it later, run the `setup` skill: `/define-openspec-change:setup`, or `$setup` in Codex.

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

| Key | Meaning |
|---|---|
| `cli` | `claude`, `codex`, `agy`, or another agent acpx can start. A lowercase letter, then lowercase letters, digits and hyphens. One entry per CLI. |
| `model` | Optional. A model ID the agent offers. Without it the agent's default model. |
| `effort` | Optional. Defaults to `high`. Applied for Claude, Codex and agy. Not passed for other agents. |

An entry with another key, a repeated `cli`, or an empty list makes the config invalid. The setup skill recommends one entry per installed CLI, shows you the list, and writes nothing until you confirm. It checks that acpx is installed and keeps any other keys in the file. See [Crosschecks](crosschecks.md) for which entries run.
