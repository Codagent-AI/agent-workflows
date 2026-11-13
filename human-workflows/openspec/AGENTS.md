# human-workflows/openspec

The define-openspec-change plugin. The README is for people who use it; this file is for people who change it.

## Layout

```
human-workflows/openspec/
  openspec/                    OpenSpec changes for this plugin; not part of the plugin
  plugin/                      the installable plugin root
    .claude-plugin/plugin.json
    .codex-plugin/plugin.json  skills, plus .codex-mcp.json for the server
    .mcp.json                  Claude Code: node ${CLAUDE_PLUGIN_ROOT}/server.mjs
    .codex-mcp.json            Codex: node ./server.mjs in the plugin folder
    server.mjs                 bundled server, committed
    skills/define/             the entry point on both CLIs
    skills/setup/              writes ~/.agent-workflows/config.yaml with the user
    skills/<other skills>/     the skills the steps use
    reviews/                   review instructions that only the crosscheck child reads
    workflow.yaml              the steps, their prompts, and the shared text added to them
    PROVENANCE.md              where the skills and the workflow came from
  server/                      TypeScript source, tests, and the esbuild build
```

## Rules

- `plugin/` is the installable plugin root. Codex, and Claude Code for a Git marketplace, copy only that folder into the plugin cache, so nothing outside it is reachable at run time. Keep `node_modules` and sources out of it.
- `plugin/workflow.yaml` holds the step order, the step prompts, and `shared_prompts`, the text the server adds after a step's own prompt, so none of it is hard-coded in the server. Write text that several steps need once, under `shared_prompts`, not in each prompt. The artifact check for a step stays in `server/src/checks.ts`, keyed by step id. When you rename or add a step, update that table and the test that pins the step ids.
- `server/` holds the TypeScript tool server and its tests. `plugin/server.mjs` is the committed esbuild bundle of it.
- After changing `server/src`, run `npm run build` in `server/` and commit `plugin/server.mjs` with the source. `npm run lint` (Biome and jscpd) and `npm run check` (typecheck, a check that the bundle matches a fresh build, and the tests) must pass. Keep the code within the lint limits by restructuring it; do not raise a limit or add a suppression comment. Biome fails on cognitive complexity over 10, functions over 50 lines, files over 300 lines (500 for tests), more than 4 parameters, and shadowed names. jscpd fails on any repeated block of 50 tokens or more.
- Add tests to the existing suites in `server/test/`.
- The skills in `plugin/skills/` and `plugin/workflow.yaml` are the source of truth for define. `plugin/PROVENANCE.md` is the only place that names where they were copied from. Record what changed in a copied file there.
- Do not name the tools these files were copied from anywhere else in this folder, such as in READMEs, code comments, tests, skills, or the workflow prompts.
- The plugin's version is set in `plugin/.claude-plugin/plugin.json`. Keep it the same in `plugin/.codex-plugin/plugin.json` and `server/package.json`; `npm run build` stops if they differ. The server reports the manifest's version, injected at build time. The Claude marketplace entry has no version, so the plugin manifest wins. Keep the plugin name the same in the manifests and both marketplace files.
- The Claude Code entry point is the `define` skill. Do not add a `commands/define.md`: a command with the same name makes Claude Code list `/define-openspec-change:define` twice.

## Development

```sh
cd human-workflows/openspec/server
npm install
npm run build   # writes ../plugin/server.mjs
npm run lint    # Biome and jscpd
npm run check   # typecheck, bundle-matches-build check, tests
```

## How Codex runs the server

- Codex 0.166 does not expand `${CLAUDE_PLUGIN_ROOT}` in a plugin's `.mcp.json`. So the Codex manifest names its own server file, `.codex-mcp.json`, which starts `node ./server.mjs` with `cwd: "."`, in the plugin folder.
- The server needs the session's working folder to create the change, run `openspec`, and commit. Claude Code sets `CLAUDE_PROJECT_DIR` for the servers it starts. On Codex the server declares the `codex/sandbox-state-meta` capability and reads `sandboxCwd` from each tool call's `_meta`.
- Codex passes an MCP server only a few variables, such as `HOME` and `PATH`. `.codex-mcp.json` forwards the rest through `env_vars`: the child CLIs' credentials and settings, `GH_TOKEN` and the other `gh` and git variables, and `DEFINE_OPENSPEC_CHANGE_WAIT_SECONDS`. Claude Code passes its whole environment.
- Do not switch to Codex's portable plugin format (a root `plugin.json` and `mcp.json` with the `$schema` marker). Its `mcp.json` has no `env_vars`, and it passes `${VAR}` in `env` on as literal text, so the server would not get those variables.
