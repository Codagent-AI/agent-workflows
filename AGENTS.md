# agent-workflows

## Layout rule

- Top-level folders are named by purpose: `human-workflows/` for plugins where a person and an agent work together, and `factory-workflows/` for workflows an agent runs without a person.
- Folders under them are named by what they depend on: `human-workflows/openspec/`, `human-workflows/archon/`, `factory-workflows/archon/`.
- New work goes under the purpose folder it serves. Add a dependency folder when the dependency differs.
- Keep the README's layout table current when you add a folder.
- Each project folder keeps the rules for changing it in its own `AGENTS.md`, such as `human-workflows/openspec/AGENTS.md`.
- OpenSpec changes for every project live in the one OpenSpec project at the repository root, `openspec/`. Do not add an `openspec/` folder inside a project. `openspec/config.yaml` holds the context for all projects.

## Hard rule: don't test static content

This applies to every project in this repository, with no exceptions. Models add these tests by reflex. Before you write any assertion on text, check it against this rule.

Static content is text with no logic behind it: skills, command and prompt files, review instructions and other markdown, prompts in YAML such as `workflow.yaml` and the Archon workflows, and tool descriptions. A test of its words only restates it and breaks on every edit. Never write one. That includes:

- reading a skill, prompt, markdown, or YAML prompt file in a test to check what it says;
- checking that a resolved prompt contains text that came from a prompt file, for example with `resolved-text-contains` in an Archon fixture;
- checking the instructions inside a message the code returns, when the rest of the message already shows which branch ran, such as "Do not ask the user for one" in a refusal.

Test code. Where code picks different text on different branches, or builds text from data, test that: the right branch's text came out, the data went in, the parts are in the right order. Match only as much text as it takes to tell the branch or the data apart.

If you find a test of static content in a test file you touch, delete it in the same change.

## Paul's workflow

Paul changes the pack (`factory-workflows/archon`) in one Claude session, from definition to evals:

1. **Define.** Paul writes the change with the `define-openspec-change` plugin's `define` skill. It lands in `openspec/changes/<name>`.
2. **Implement.** When Paul says so, run it with the `codagent-archon` plugin's `implement-change` skill, with this checkout as the pack. The pack on main builds the change on its own branch, archives it, and marks its PR ready for review with a "Review first" section in the description.
3. **Human verification.** Help Paul verify the PR. Walk through its "Review first" section, the change's decision and dispute logs, and any human-only checks in the change's test plan. Change the implementation branch only when he asks.
4. **Evals.** Run the reps Paul asks for (default 1) with the `archon-fly-eval` skill, setting `agent_workflows_ref` to the implementation branch. Paul rates reps first, and only then do you report scores.
5. Paul merges the pack PR.

**When the eval harness needs a change too.** Only the pack can be on a branch. agent-evals (which holds the Fly launcher, `evals/agent-runner/archon-fly/launcher/bin/fly-eval`) and Archon (a commit on the fork's `dev`) run only merged code.

- Before the first rep, check the change for anything the harness depends on:
  - an artifact the judges read, renamed or moved;
  - a new role or pack setting;
  - a different end state for the branch, the PR or the change, which the delivery check would reject.
- Make that harness change in the same session, as its own PR from a sibling worktree of that repo. Make it work with both the branch and pack main, for example by keying it off a setting the pack declares, so the baseline and the weekly eval don't change.
- After Paul merges it, fast-forward that main checkout (the launcher needs no install step), then launch the reps.
- A rep that fails with owner `evaluation-harness`, or fails delivery verification, usually means a missed harness change. Fix it the same way, then rescore or rerun.

## Releases

- The repository has one version, in the root `VERSION` file. It covers both plugins and the Archon pack. Do not edit a version anywhere else: `node scripts/sync-versions.mjs` writes it into the plugin manifests, the define plugin's `server/package.json` and lockfile, and the Claude Code marketplace entries, and `--check` fails when any differs. The Agent Validator runs the check.
- A release is a pull request that bumps `VERSION` and adds a `CHANGELOG.md` section, made with the `release` skill in `.claude/skills/release/`. Nobody tags by hand. Merging to `main` runs `.github/workflows/release.yml`, which runs `node scripts/release.mjs`. The script does nothing when the tag `v<version>` exists. Otherwise it creates the tag and a GitHub release, with the changelog section as notes and the pack (`factory-workflows/archon/.archon/`) attached as `agent-workflows-pack_<version>.tar.gz` with a `checksums.txt`.
- Only the release PR changes `VERSION`. The workflow passes the push's before and after commits, and `release.mjs` releases only when the push changed `VERSION`, so a merge that does not change it releases nothing.

## Design doc

The design of Codagent on Archon as a whole, with the architecture of the factory, is a private claude.ai artifact: https://claude.ai/artifact/VoxywQB5VkgqcNDTHsaV1q. The pack's own design doc is named in `factory-workflows/archon/AGENTS.md`. Keep this one up to date as the repository changes. When you define a change that alters the big picture (the architecture, the layout, how the projects connect, or what Archon provides), update the doc during the define workflow, ideally at the proposal stage, and mark what the change adds until it merges. Don't update it while implementing a change, or list it as implementation work in a proposal: an implementation run, such as Archon's, can't open or republish a private claude.ai page. To update it, read it with the Artifact tool, edit that copy, and republish to the same URL. Don't make it more detailed: it should have all the important details, and everything in it should be accurate.
