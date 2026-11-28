# Codagent workflows for Archon

The `codagent` workflow pack for the [Archon](https://github.com/coleam00/Archon) engine. It takes an approved change definition, has agents implement it against a checklist of how each spec behavior is verified, audits the result, opens a draft pull request, runs acceptance rounds, archives the OpenSpec change, marks the pull request ready, fixes CI and comments, and publishes a review page for you. A run never merges unless you choose Merge on that page.

This folder is the workflow source Archon reads: pass it to `--workflow-source`. `PROVENANCE.md` says where the workflows came from.

The entry point is `codagent-implement-change`. It includes `codagent-check-definition` and `codagent-commit-definition`.

```bash
archon workflow run codagent-implement-change \
  --cwd /path/to/target --no-worktree \
  --workflow-source /path/to/agent-workflows/factory-workflows/archon \
  --input change_name=<name>
```

`change_name` is the only input a launch must give. To run it from your coding agent's session instead, install the `codagent-archon` plugin.

## Documentation

- [Setup](../../docs/setup.md): Archon, the fork the pack needs, the forge plugin, and how the pack is read
- [Roles and settings](../../docs/roles-and-settings.md): bind the role aliases and set the pack's settings
- [Implementing a change](../../docs/implementing-a-change.md): launching a run, what it does, and what stops it
- [Reviewing a run](../../docs/reviewing-a-run.md): the review page, its rounds, and Merge
- [Workflow reference](../../docs/workflow-reference.md): steps, checks, the acceptance gate, outcomes and run files

Rules for changing the pack, its layout, tests and live trials are in [AGENTS.md](AGENTS.md).
