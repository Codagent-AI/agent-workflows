# agent-workflows

Codagent workflows. Human workflows are plugins where you and an agent work together in your own session. Factory workflows run on a workflow engine without you.

## Layout

Top-level folders are named by purpose. The folders under them are named by what they depend on.

| Folder | What it holds |
|---|---|
| [`human-workflows/openspec/`](human-workflows/openspec/) | `define-openspec-change`, a Claude Code and Codex plugin that defines an OpenSpec change step by step in your own session |
| `factory-workflows/archon/` | Codagent's factory workflows for the Archon engine (not on `main` yet) |

The repository root is also a plugin marketplace for both CLIs:

- `.claude-plugin/marketplace.json` for Claude Code
- `.agents/plugins/marketplace.json` for Codex

Both list the plugins under `human-workflows/`. On Claude Code, install one with:

```
/plugin install define-openspec-change --marketplace Codagent-AI/agent-workflows
```

The full install steps for both CLIs are in each plugin's README.

## License

MIT. See [LICENSE](LICENSE).
