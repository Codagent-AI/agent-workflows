---
name: setup
description: Check acpx and configure the reviewer list in ~/.agent-workflows/config.yaml. Use when next_step or crosscheck reports a setup problem, or when the user asks to configure reviewers.
---

# Set up crosscheck

1. Run `acpx --version`. Crosscheck requires acpx 0.23 or later on `PATH`. If it is missing or older, explain that and offer `npm install -g acpx@latest`. Run the install command only after explicit user confirmation, then check the version again.
2. Read `~/.agent-workflows/config.yaml` if it exists. Preserve other keys and retain custom reviewer entries the user wants.
3. Find installed CLIs with `command -v claude`, `command -v codex`, and `command -v agy`. Recommend one entry per installed CLI. If only one is installed, explain that reviews run on the same CLI as the lead when it uses that CLI, in a separate session. With several available reviewers, every non-lead entry runs together.
4. Show the proposed list, including the recommended models and effort below. Ask which entries to use. Write the agreed list under `human-workflows.crosscheck` in the config file, creating its directory if needed. Ensure the configured agents are signed in. For any acpx use beyond the plugin's one-shot command, find the acpx package through `npm root -g` and read the skill shipped with that package.

```yaml
human-workflows:
  crosscheck:
    - cli: claude
      model: opus
      effort: high
    - cli: codex
      model: gpt-6-astra
      effort: high
    - cli: agy
      model: gemini-4-neon
      effort: high
```

Other acpx agent names may be added. Use one entry per CLI. The optional model must be a model ID the agent offers. Effort defaults to `high` and is applied to Claude, Codex and agy.

After setup succeeds, retry the original call if the setup refusal interrupted it.
