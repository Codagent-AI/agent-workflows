# agent-workflows

Agent Workflows is an opinionated toolkit for spec-driven development that just works out of the box. You write each spec with an agent. Then a software factory builds, reviews and tests the change, and hands back a pull request with the key decisions and results highlighted.

## Deterministic workflows

You and an agent write a spec by following a pre-defined workflow, one step at a time. Then the factory implements and verifies the change via a deterministic sequence of steps of its own. In neither phase does the model decide which steps to follow or which shortcuts to take. Code controls the order of the steps and checks that each step's documents exist before the next one starts.

## Opinions

- **Spec-driven development, with OpenSpec.** Every change starts as an OpenSpec change: a proposal, specs, a design, and a test plan. A spec is not a ticket. You still do the thinking. The tasks are not defined up front, the factory figures out how to break down the work.
- **Archon is the factory:** You hand off a finished spec, and Archon implements it, verifies it, and opens a pull request.
- **One spec at a time.** While the factory builds one, you are free to write the next with an agent.
- **The factory doesn't interrupt you.** Your work happens at the beginning and the end, not in the middle. You give the factory a well-defined spec, and it records the assumptions and decisions it made for you to review.
- **Humans make the judgment calls.** You review the spec, the agents' decisions and unsettled disagreements, and the results. Agents review the diff and fix CI failures before a person sees the pull request.
- **Claude Code and Codex, on the subscription you already have.** An API key works too, and you don't need both. The factory can also run Pi, or any other agent Archon supports.

## Features

Agent Workflows builds on OpenSpec and Archon. This is what each one provides, and what Agent Workflows adds.

| Feature | OpenSpec | Archon | Agent Workflows |
|---|:-:|:-:|:-:|
| Change documents: a proposal, spec deltas, and a design | ✓ | | |
| Validate a change, and archive it into the living specs | ✓ | | |
| Define a change one step at a time, in an order code enforces | | | ✓ |
| A test plan for each change | | | ✓ |
| An agent from the other vendor reviews the proposal and the approach | | | ✓ |
| YAML workflows that run their steps in a fixed order, with loops and gates | | ✓ | |
| An isolated worktree for each run | | ✓ | |
| Claude Code, Codex, and Pi, on your own subscription | | ✓ | |
| Resume a failed run | | ✓ | |
| An event log, transcript, and cost for every run, and a web UI | | ✓ | |
| Implement a spec against a checklist of how each behavior is verified | | | ✓ |
| Acceptance testing by an independent agent, in rounds | | | ✓ |
| Log the agents' decisions and unsettled disagreements, and rank them with the results in a review package | | | ✓ |
| Archive the change when the build finishes, so the living specs stay current | | | ✓ |

## Documentation

- [Introduction](docs/introduction.md)
- [Quickstart](docs/quickstart.md): install both plugins and take one small change from definition to merge
- [Setup](docs/setup.md): requirements, Archon and its fork
- [Defining a change](docs/defining-a-change.md)
- [Crosschecks](docs/crosschecks.md)
- [Implementing a change](docs/implementing-a-change.md)
- [Reviewing a run](docs/reviewing-a-run.md)
- [Roles and settings](docs/roles-and-settings.md)
- [Workflow reference](docs/workflow-reference.md)
- [Glossary](docs/glossary.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Development](docs/development.md)
- [Coming from Agent Runner](docs/coming-from-agent-runner.md)

## Layout

Human workflows are plugins where you and an agent work together in your own session. Factory workflows are workflows an agent runs without a person.

Top-level folders are named by purpose. The folders under them are named by what they depend on.

| Folder | What it holds |
|---|---|
| [`human-workflows/openspec/`](human-workflows/openspec/) | `define-openspec-change`, a Claude Code and Codex plugin that defines an OpenSpec change step by step in your own session |
| [`human-workflows/archon/`](human-workflows/archon/) | `codagent-archon`, a Claude Code and Codex plugin that runs the factory workflows on Archon from your own session and follows each run |
| [`factory-workflows/archon/`](factory-workflows/archon/) | Codagent's factory workflows for the Archon engine |
| [`openspec/`](openspec/) | The OpenSpec changes for every project in this repository |
| [`docs/`](docs/) | The user docs |

The repository root is also a plugin marketplace for both CLIs:

- `.claude-plugin/marketplace.json` for Claude Code
- `.agents/plugins/marketplace.json` for Codex

Both list the plugins under `human-workflows/`. On Claude Code, install one with:

```
/plugin marketplace add Codagent-AI/agent-workflows
/plugin install define-openspec-change@agent-workflows
```

On Codex, from a clone of this repository:

```sh
codex plugin marketplace add /path/to/agent-workflows
codex plugin add define-openspec-change@agent-workflows
```

The [Quickstart](docs/quickstart.md) has the full install steps for both CLIs.

## License

MIT. See [LICENSE](LICENSE).
