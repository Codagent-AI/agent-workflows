# Codagent workflows for Archon

The `codagent` workflow pack for the Archon engine. See README.md for the layout, how to run a workflow, the files a run writes, and how to test. Paths below are relative to this folder.

## Design balance

Every part of a workflow weighs two goals:

- **The agents reach the right outcome.** Real defects get fixed. Wrong findings get declined, and the declines are accepted. Real disagreements and open questions reach the person with both sides. No agent gives in or holds out for the wrong reason. Give each agent the context, evidence and choices it needs to decide well.
- **The machinery stays small.** Each node, script, piece of state, loop, special case and failure path is more to test and another way for a run to go wrong.

Add machinery only where it clearly raises the chance of the right outcome. Prefer a bounded loop, a clear instruction, or a hand-off to the person over state that tracks every case. When a rare case would need new state or a new failure path, accept the limit and record it in the change's design. A run that leaves an open question for the person is better than one that fails or one that hides the question.

## Rules

- Keep the pack under `.archon/workflows/codagent/`. A workflow's commands, scripts and fixtures sit in its own folder. Modules several scripts import go in `.shared/lib/`, and documents several agent nodes read go in `.shared/`, read through `$PACK_DIR`.
- Write checks as TypeScript script nodes run by bun, importing from `.shared/lib/`. No shell scripts, and nothing specific to one provider.
- Every agent node names a role alias with a tier fallback (`['@implementor', large]`), never a provider, model or effort, and sets `context` explicitly.
- A `context: fresh` node's command starts with the autonomy preamble ("You are running autonomously with no human in the loop..."), and the fixtures check that it does.
- Agents and scripts share the `$ARTIFACTS_DIR` files README.md lists. Rename one only everywhere at once.
- With any change to a check, a repair, or a branch condition, add or change a fixture. With any change to `.shared/lib/`, add or change a bun test. Before committing, run both test layers and the lint as README.md's Tests section describes. None of them makes model calls. Keep the code within the lint limits by restructuring it; do not raise a limit or add a suppression comment.
- Add tests to the existing fixtures and `tests/*.test.ts`. Do not add a test suite or CI job.
- A live trial (README.md, Live trials) is available for testing a pack change with real agents. Start one only when the user allows it, in the change's test plan or in conversation, and clean it up when the run stops.
- Only `PROVENANCE.md` names the projects the pack was ported from. Record there any change that moves the pack further from its source.
- Commit messages: `type: lowercase description`, with type one of `fix`, `feat`, `chore`, `refactor`, `test`, or `docs`.
