# agent-workflows

Codagent workflows. Some run inside your own agent session as plugins; others run on a workflow engine.

## Layout

Top-level folders are named by purpose. The folders under them are named by what they depend on.

| Folder | What it holds |
|---|---|
| [`spec-driven-workflows/openspec/`](spec-driven-workflows/openspec/) | `define-openspec-change`, a Claude Code and Codex plugin that defines an OpenSpec change step by step in your own session |
| `factory-workflows/archon/` | Codagent's factory workflows for the Archon engine (not on `main` yet) |

The repository root is also a plugin marketplace for both CLIs:

- `.claude-plugin/marketplace.json` for Claude Code
- `.agents/plugins/marketplace.json` for Codex

Both list the plugins under `spec-driven-workflows/`. The install steps are in each plugin's README.

## License

MIT. See [LICENSE](LICENSE).
