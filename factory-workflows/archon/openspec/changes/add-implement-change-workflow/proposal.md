# Proposal

## Why

The `codagent` pack for the Archon engine had no way to take an approved change definition all the way to a pull request a human can accept. This change adds that path: an implementor works against a checklist, a second agent audits it, and independent acceptance rounds prepare a draft pull request. The pack records its provenance in `PROVENANCE.md`.

## What Changes

- Add the `codagent-implement-change` workflow, the entry point. It checks and commits the definition, has one implementor session write a checklist, implement the change and record evidence, has a crosscheck audit it, and then runs verification.
- Add the `codagent-verify-change` workflow. It reviews the implementation's assumptions, opens a draft pull request, and runs bounded acceptance rounds until a gate says the change has converged.
- Add the building blocks `codagent-check-definition` and `codagent-commit-definition`.
- Add pack settings with defaults for an OpenSpec repository, so a launch gives only `change_name`.
- Reach the pull request through the Archon forge operations instead of `gh`, except for review threads and comments.
- Add TypeScript checks run as script nodes, dry-run fixtures for each workflow, bun tests for the shared modules, and a lint setup.

## Capabilities

### New Capabilities

- `change-implementation`: the `codagent-implement-change` workflow and its definition check, definition commit, checklist, evidence, audit, cleanliness and session report steps.
- `acceptance-rounds`: the `codagent-verify-change` workflow, from assumption review to the convergence gate and the run's outcome.
- `draft-pull-request`: how the pack reaches the forge, opens and keeps the pull request a draft, publishes its description, and reports CI.
- `pack-settings-and-run-files`: the pack settings, input validation, role aliases, the check and repair pattern, and the files a run shares.

### Modified Capabilities

None. The project has no specs yet.

## Impact

- New code under `factory-workflows/archon/.archon/workflows/codagent/` (four workflows, their commands, scripts and fixtures, and `.shared/`).
- New tests under `factory-workflows/archon/tests/`.
- Runtime needs: Archon with `--workflow-source` and `$PACK_DIR`, bound role aliases, `git` with push access, the Archon forge plugin for the remote's host, and the `openspec` CLI for an OpenSpec change.
- No change to any other folder of the repository.
