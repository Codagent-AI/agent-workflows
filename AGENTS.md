# agent-workflows

## Layout rule

- Top-level folders are named by purpose: `human-workflows/` for plugins where a person and an agent work together, and `factory-workflows/` for workflows an agent runs without a person.
- Folders under them are named by what they depend on: `human-workflows/openspec/`, `factory-workflows/archon/`.
- New work goes under the purpose folder it serves. Add a dependency folder when the dependency differs.
- Keep the README's layout table current when you add a folder.

## human-workflows/openspec

- `plugin/` is the installable plugin root. Codex, and Claude Code for a Git marketplace, copy only that folder into the plugin cache, so nothing outside it is reachable at run time. Keep `node_modules` and sources out of it.
- `plugin/workflow.yaml` holds the step order and the step prompts, so they are not hard-coded in the server. The artifact check for a step stays in `server/src/checks.ts`, keyed by step id. When you rename or add a step, update that table and the test that pins the step ids.
- `server/` holds the TypeScript tool server and its tests. `plugin/server.mjs` is the committed esbuild bundle of it.
- After changing `server/src`, run `npm run build` in `server/` and commit `plugin/server.mjs` with the source. `npm run lint` (Biome and jscpd) and `npm run check` (typecheck, a check that the bundle matches a fresh build, and the tests) must pass. Keep the code within the lint limits by restructuring it; do not raise a limit or add a suppression comment.
- Add tests to the existing suites in `server/test/`.
- The skills in `plugin/skills/` were copied from Agent Skills and are now the source of truth for define. Record what changed in a copied file in `plugin/PROVENANCE.md`.
- Keep the plugin name and version the same in `plugin/.claude-plugin/plugin.json`, `plugin/.codex-plugin/plugin.json`, and `.claude-plugin/marketplace.json`.
