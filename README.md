# agent-workflows

Agent Workflows is an opinionated toolkit for spec-driven development. It has what you need to write good specs with an agent and then hand them to a factory that implements and verifies them, with little to configure.

## Deterministic workflows

You and an agent write a spec by following a defined workflow, one step at a time. Then the factory implements and verifies the change through defined steps of its own. In neither phase does the model decide which steps to follow or which shortcuts to take. Code controls the order of the steps and checks that each step's documents exist before the next one starts. It does not check that the agent did the work inside a step, such as running a review.

## Opinions

- **Spec-driven development, with OpenSpec.** Every change starts as an OpenSpec change: a proposal, specs, a design, and a test plan.
- **A factory implements the spec, and the factory is Archon.** You hand off a finished spec, and Archon implements it, verifies it, and opens a pull request.
- **Claude Code and Codex, on your subscriptions.** An API key works too, and you don't need both. The factory can also run Pi, or any other agent Archon supports.
- **People review non-trivial work.** They review the technical design, the decisions the agents made, and the verification results.

## Layout

Human workflows are plugins where you and an agent work together in your own session. Factory workflows are workflows an agent runs without a person.

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
