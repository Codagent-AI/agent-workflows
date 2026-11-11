# agent-workflows

## Layout rule

- Top-level folders are named by purpose: `human-workflows/` for plugins where a person and an agent work together, and `factory-workflows/` for workflows an engine runs without a person.
- Folders under them are named by what they depend on: `human-workflows/openspec/`, `factory-workflows/archon/`.
- New work goes under the purpose folder it serves. Add a dependency folder when the dependency differs.
- Keep the README's layout table current when you add a folder.

## human-workflows/openspec

- `plugin/` is the installable plugin root. Codex, and Claude Code for a Git marketplace, copy only that folder into the plugin cache, so nothing outside it is reachable at run time. Keep `node_modules` and sources out of it.
- `server/` holds the TypeScript tool server and its tests. `plugin/server.mjs` is the committed esbuild bundle of it.
- After changing `server/src`, run `npm run build` in `server/` and commit `plugin/server.mjs` with the source. `npm run check` (typecheck, a check that the bundle matches a fresh build, and the tests) must pass.
- Add tests to the existing suites in `server/test/`.
- The skills in `plugin/skills/` were copied from Agent Skills and are now the source of truth for define. Record what changed in a copied file in `plugin/PROVENANCE.md`.
- Keep the plugin name and version the same in `plugin/.claude-plugin/plugin.json`, `plugin/.codex-plugin/plugin.json`, and `.claude-plugin/marketplace.json`.
