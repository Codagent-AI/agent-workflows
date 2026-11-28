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
- A `context: fresh` node's command starts with the autonomy preamble ("You are running autonomously with no human in the loop...").
- Agents and scripts share the `$ARTIFACTS_DIR` files README.md lists. Rename one only everywhere at once.
- With any change to a check, a repair, or a branch condition, add or change a fixture. With any change to `.shared/lib/`, add or change a bun test. Before committing, run both test layers and the lint as README.md's Tests section describes. None of them makes model calls. Keep the code within the lint limits by restructuring it; do not raise a limit or add a suppression comment.
- Add tests to the existing fixtures and `tests/*.test.ts`. Do not add a test suite or CI job.
- Test only what "What to test" below says to test.
- A live trial (README.md, Live trials) is available for testing a pack change with real agents. Start one only when the user allows it, in the change's test plan or in conversation, and clean it up when the run stops.
- Only `PROVENANCE.md` names the projects the pack was ported from.
- Commit messages: `type: lowercase description`, with type one of `fix`, `feat`, `chore`, `refactor`, `test`, or `docs`.

## What to test

The pack is code and static content. Test the code. Never test the static content: people review it.

**Static content, never tested:**

- every command file under `<workflow>/commands/`;
- the documents agents read from `.shared/`, such as `implement-change.md` and `verify-behavior.md`;
- any other markdown in the pack, and the wording of a required passage such as the autonomy preamble.

No test or fixture may read these files, quote them, or check that a node's resolved prompt contains text from them.

**Code, tested:**

- `.shared/lib/` modules and the workflows' `scripts/`, with bun tests in `tests/*.test.ts`. That includes the text a script builds or chooses by branch, such as `problems`, reasons, CI reports, handoffs, PR bodies and the review package.
- The workflow YAML's graph, with dry-run fixtures: which nodes a path reaches, branch conditions, repairs and the outcome.
- The YAML's wiring, with bun tests: bindings, settings passed to blocks, timeouts, loop limits, roles, `context`, and output schemas.
- That one node's output reaches the next node's prompt, with a fixture's `resolved-text-contains`. It may name only text that a stub or the test's inputs supply.

## Finish path

- Only OpenSpec changes under the target repository's `openspec/changes/<name>` are supported. Do not restore change-kind settings or provider-specific code.
- The inspection audit runs on `@reviewer` with a large fallback; code review and ranking use reviewer/medium and completion judgment uses tester/medium.
- Keep completion verdict limits and progress checks independent of the judge. Preserve report-mode continuation from the end of acceptance through archive and finalize to the package; earlier checks keep their fatal defaults.
- Commit the decision and dispute logs before archive; later agent entries belong to the committed current change folder. Preserve unrelated index and worktree changes during archive commits.
- PR state and description mutations use the forge. The finalize fixer may reply/resolve comment threads with gh; mark every reply with `<!-- codagent-reply -->`. Merge only on the reviewer’s current-page merge answer and only at the reviewed head when archive and finalize passed.
- Ranking requirements are inventoried independently of the ranking agent. Preserve external PR text and verify the published generated body by reading it back.

## Design doc

The pack's high-level design is a private claude.ai artifact: https://claude.ai/artifact/MjJSm1v3iftyrPdrV4ZVLj. Keep it up to date as the pack changes. When you define a change to the pack, update the doc during the define workflow, ideally at the proposal stage, and mark what the change adds until it merges. Don't update it while implementing a change, or list it as implementation work in a proposal: an implementation run, such as Archon's, can't open or republish a private claude.ai page. To update it, read it with the Artifact tool, edit that copy, and republish to the same URL. Don't make it more detailed: it should have all the important details, and everything in it should be accurate.
