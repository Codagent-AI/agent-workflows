# agent-workflows

Codagent workflows for the Archon engine. See README.md for the layout, how to run a workflow, and how the port differs from Agent Runner.

## Rules

- Keep the pack under `.archon/workflows/codagent/`. Shared shell scripts go in `.shared/`; a workflow's own scripts and command prompts sit next to it.
- `.shared/core/` holds Agent Runner's scripts copied unchanged. Change them only by copying a newer Runner version, and say which in the commit.
- Every agent node names a role alias (`@lead`, `@crosscheck`, `@implementor`, `@tester`), never a concrete model. Bindings live in `roles/` and in a caller's `--config` layer.
- Session files keep Agent Runner's names under `session_dir/output/`: the agent-evals and-scene suite and the ported prompts read them.
- Add or change a dry-run scenario in `tests/scenarios.py` with any change to a check, a repair, or a branch condition, and run `python3 tests/scenarios.py` before committing. Dry runs make no model calls.
- A paid run happens through the agent-evals and-scene suite (`run.sh --engine archon`), not from here.
- Commit messages: `type: lowercase description`, with type one of `fix`, `feat`, `chore`, `refactor`, `test`, or `docs`.
