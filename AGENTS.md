# agent-workflows

## Layout rule

- Top-level folders are named by purpose: `human-workflows/` for plugins where a person and an agent work together, and `factory-workflows/` for workflows an agent runs without a person.
- Folders under them are named by what they depend on: `human-workflows/openspec/`, `factory-workflows/archon/`.
- New work goes under the purpose folder it serves. Add a dependency folder when the dependency differs.
- Keep the README's layout table current when you add a folder.
- Each project folder keeps the rules for changing it in its own `AGENTS.md`, such as `human-workflows/openspec/AGENTS.md`.
- OpenSpec changes for every project live in the one OpenSpec project at the repository root, `openspec/`. Do not add an `openspec/` folder inside a project. `openspec/config.yaml` holds the context for all projects.

## Paul's workflow

Paul changes the pack (`factory-workflows/archon`) in one Claude session, from definition to evals:

1. **Define.** Paul writes the change with the `define-openspec-change` plugin's `define` skill. It lands in `openspec/changes/<name>`.
2. **Implement.** When Paul says so, run it with the `archon-implement-change` skill. The pack on main builds the change on its own branch, archives it, and marks its PR ready for review with a "Review first" section in the description.
3. **Human verification.** Help Paul verify the PR. Walk through its "Review first" section, the change's decision and dispute logs, and any human-only checks in the change's test plan. Change the implementation branch only when he asks.
4. **Evals.** Run the reps Paul asks for (default 1) with the `archon-fly-eval` skill, setting `agent_workflows_ref` to the implementation branch. Paul rates reps first, and only then do you report scores.
5. Paul merges the pack PR.

**When the eval harness needs a change too.** Only the pack can be on a branch. agent-evals, the Fly launcher (`~/codagent/agent-factory`) and Archon (a commit on the fork's `dev`) run only merged code.

- Before the first rep, check the change for anything the harness depends on:
  - an artifact the judges read, renamed or moved;
  - a new role or pack setting;
  - a different end state for the branch, the PR or the change, which the delivery check would reject.
- Make that harness change in the same session, as its own PR from a sibling worktree of that repo. Make it work with both the branch and pack main, for example by keying it off a setting the pack declares, so the baseline and the weekly eval don't change.
- After Paul merges it, fast-forward that main checkout (for agent-factory, also run `uv sync --frozen`), then launch the reps.
- A rep that fails with owner `evaluation-harness`, or fails delivery verification, usually means a missed harness change. Fix it the same way, then rescore or rerun.
