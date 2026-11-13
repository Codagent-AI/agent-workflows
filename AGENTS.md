# agent-workflows

## Layout rule

- Top-level folders are named by purpose: `human-workflows/` for plugins where a person and an agent work together, and `factory-workflows/` for workflows an agent runs without a person.
- Folders under them are named by what they depend on: `human-workflows/openspec/`, `factory-workflows/archon/`.
- New work goes under the purpose folder it serves. Add a dependency folder when the dependency differs.
- Keep the README's layout table current when you add a folder.
- Each project folder keeps the rules for changing it in its own `AGENTS.md`, such as `human-workflows/openspec/AGENTS.md`.
