# Codagent workflows for Archon

The `codagent` workflow pack for the Archon engine. See README.md for the layout, how to run a workflow, the files a run writes, and how to test. Paths below are relative to this folder.

## Rules

- Keep the pack under `.archon/workflows/codagent/`. A workflow's commands, scripts and fixtures sit in its own folder. Modules several scripts import go in `.shared/lib/`, and documents several agent nodes read go in `.shared/`, read through `$PACK_DIR`.
- Write checks as TypeScript script nodes run by bun, importing from `.shared/lib/`. No shell scripts, and nothing specific to one provider.
- Every agent node names a role alias with a tier fallback (`['@lead', large]`), never a provider, model or effort, and sets `context` explicitly.
- A `context: fresh` node's command starts with the autonomy preamble ("You are running autonomously with no human in the loop..."), and the fixtures check that it does.
- Agents and scripts share the `$ARTIFACTS_DIR` files README.md lists. Rename one only everywhere at once.
- With any change to a check, a repair, or a branch condition, add or change a fixture. With any change to `.shared/lib/`, add or change a bun test. Before committing, run both test layers as README.md's Tests section describes. Neither makes model calls.
- Add tests to the existing fixtures and `tests/*.test.ts`. Do not add a test suite or CI job.
- Only `PROVENANCE.md` names the projects the pack was ported from. Record there any change that moves the pack further from its source.
- Commit messages: `type: lowercase description`, with type one of `fix`, `feat`, `chore`, `refactor`, `test`, or `docs`.
