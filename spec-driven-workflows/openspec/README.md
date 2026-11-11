# define-openspec-change

A Claude Code and Codex plugin that defines an OpenSpec change in your own session. It takes the change through five steps:

1. proposal
2. specs
3. design
4. test-plan
5. approach-review

A second agent on the other vendor's CLI reviews the proposal and the finished approach. At the end the plugin validates the change and commits its documents.

The steps and their prompts come from Agent Runner's define workflow. Runner moved the agent from step to step by stopping and resuming the CLI. Here a bundled tool server returns each step's instructions when the agent calls `next_step`, so the whole define runs in one conversation.

## Requirements

- Node.js 20 or later on `PATH`. The server is one bundled file, `plugin/server.mjs`, with no install step.
- The `openspec` CLI on `PATH`, in a repository that has an `openspec/` folder.
- git. On a branch other than the default branch, `gh` must also be signed in, so the plugin can open the pull request.
- Both `claude` and `codex` on `PATH` and signed in. The crosscheck runs on the CLI that is not leading.

## Install

From a clone of this repository:

```sh
# Claude Code
claude plugin marketplace add /path/to/agent-workflows
claude plugin install define-openspec-change@agent-workflows

# Codex
codex plugin marketplace add /path/to/agent-workflows
codex plugin add define-openspec-change@agent-workflows
```

Claude Code's `--scope project` or `--scope local` on both commands keeps the plugin to one repository.

The plugin can be installed in Codex but left off by default, then turned on for one session:

```sh
codex -c plugins.define-openspec-change@agent-workflows.enabled=true
```

Write the key without quotes. Codex 0.166 ignores the quoted TOML form `plugins."define-openspec-change@agent-workflows"` in `-c`.

## Use

| CLI | Start or resume a define |
|---|---|
| Claude Code | `/define-openspec-change:define <change-name> [what you want]` |
| Codex | `$define <change-name> [what you want]` |

The change name uses lowercase letters, digits, and hyphens, for example `add-dark-mode`.

1. The agent calls `next_step` with `start: true`. That runs `openspec new change <name>` and returns the proposal step.
2. The agent works through each step with you. When a step is done, it calls `next_step` again. The server checks the step's file before it moves on, and refuses with what is missing if the file is absent or empty:
   - proposal: `proposal.md`
   - specs: at least one `specs/<capability>/spec.md`
   - design: `design.md`
   - test-plan: `test-plan.md`
3. During the proposal and approach-review steps, the agent runs a crosscheck with `call_agent`, then checks each finding itself before it brings it to you.
4. After approach-review, `next_step` finishes the define:
   1. It runs `openspec validate --type change <name>` and the planning-artifact check. If either fails, it refuses and commits nothing.
   2. It commits only `openspec/changes/<name>/`, as `chore: add change documents for <name>`. Other staged or unstaged work is left as it was, and the result lists it.
   3. On the default branch it stops there, and you push when ready.
   4. On any other branch it pushes the branch and opens a pull request against the default branch. If the push or the pull request fails, it reports that once and does not retry.

Progress is saved in `openspec/changes/<name>/.define-openspec-change.json` and committed with the change. To pick up a define in a new session, start it again with the same name. The agent gets the current step back, with no step skipped or repeated. Either CLI can resume a define the other started.

`openspec new change` creates `openspec/config.yaml` if the repository has none. That file is outside the change folder, so it is not committed.

### Approvals

- Claude Code asks before each call to the plugin's tools. To stop the prompts, allow them in your settings: `"permissions": { "allow": ["mcp__plugin_define-openspec-change_define"] }`.
- Codex runs the plugin's four tools without asking, because `plugin/.codex-mcp.json` sets them to `approve`. Without that, `codex exec` refuses every `next_step` call, since it has nobody to ask. The last `next_step` call commits, and on a branch it also pushes and opens a pull request.

## The crosscheck

`call_agent` takes `agent: "crosscheck"` and a standalone prompt. It starts one child agent, waits up to 100 seconds, and returns the child's result or `status: "running"` with a `call_id`. The lead then calls `get_agent_call` until the call ends. Only one call runs at a time, and a call can last at most 60 minutes. `cancel_agent_call` stops it.

The child has no access to the lead's conversation and runs read-only:

- **Codex child** (when Claude Code leads):
  - runs `codex exec --json --ephemeral --skip-git-repo-check -s read-only -c model_reasoning_effort="high"`;
  - has this plugin turned off;
  - still loads your own Codex configuration, including its MCP servers, plugins, and hooks. The read-only sandbox covers shell commands and file edits, not those tools.
- **Claude child** (when Codex leads):
  - runs `claude -p --setting-sources "" --strict-mcp-config --no-session-persistence`;
  - can use only Read, Grep, Glob, WebSearch, and WebFetch;
  - loads no settings, plugins, or MCP servers.

The child reads the review skill from the plugin folder by absolute path. Each call reports whether the working tree changed while the child ran.

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `DEFINE_OPENSPEC_CHANGE_CROSSCHECK_CLI` | the CLI that is not leading | `claude` or `codex` |
| `DEFINE_OPENSPEC_CHANGE_CROSSCHECK_MODEL` | the CLI's default | model for the child |
| `DEFINE_OPENSPEC_CHANGE_CROSSCHECK_EFFORT` | `high` | reasoning effort for the child |
| `DEFINE_OPENSPEC_CHANGE_WAIT_SECONDS` | `100` | how long `call_agent` and `get_agent_call` wait before they return `running` |

Set them in the environment that starts the CLI.

- Claude Code passes its whole environment to the server.
- Codex passes MCP servers only a few variables, such as `HOME` and `PATH`. `plugin/.codex-mcp.json` forwards these four through `env_vars`, along with the variables the child CLIs, git, and `gh` need: `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `SSH_AUTH_SOCK`, `GIT_SSH_COMMAND`, `GH_TOKEN`, `GITHUB_TOKEN`, `GH_HOST`, `GH_CONFIG_DIR`, and `XDG_CONFIG_HOME`.

Logs go to `$TMPDIR/define-openspec-change/`:

- `server-starts.log` gets one line each time the server starts.
- `<repo-hash>/events.jsonl` records each tool call.
- `<repo-hash>/<call_id>/` holds each crosscheck's prompt, command, output, and final message.

## How Codex runs the server

Codex 0.166 does not expand `${CLAUDE_PLUGIN_ROOT}` or any other plugin-root variable in a plugin's `.mcp.json`. So the Codex manifest names its own server file, `.codex-mcp.json`, which starts `node ./server.mjs` with `cwd: "."`. That makes Codex start the server in the plugin folder. The server then reads the session's directory from each tool call's `_meta`, which Codex sends as `codex/sandbox-state-meta` and `x-codex-turn-metadata`. Claude Code reads `.mcp.json` and starts the server in the session directory.

## Differences from Runner's define

- **No preflight.** Define can run on `main` and on a dirty tree. It still checks the change name, and it refuses a change folder it did not start.
- **Finish.** Runner left committing to you. Here the last `next_step` validates, then commits only the change folder. On a branch it also pushes and opens a pull request. On the default branch it only commits.
- **The child is read-only.** Runner told the reviewer not to write. Here the child runs in a read-only sandbox or with read-only tools.
- **One crosscheck per call.** There are no `session` or `follow_up` targets. Each call starts a fresh child, and the lead puts follow-up questions in a new call.
- **No agent switch between steps.** The lead you start with runs every step.
- **No task steps.** Runner's plan-tasks and review-tasks steps are left out, because change v3 no longer uses them.
- **Starting and resuming** both use `next_step` with `start: true`. A later call without `start` completes the current step, so a new session cannot skip a step by mistake.

## Layout

```
spec-driven-workflows/openspec/
  README.md
  plugin/                      the installable plugin root
    .claude-plugin/plugin.json
    .codex-plugin/plugin.json  skills, plus .codex-mcp.json for the server
    .mcp.json                  Claude Code: node ${CLAUDE_PLUGIN_ROOT}/server.mjs
    .codex-mcp.json            Codex: node ./server.mjs in the plugin folder
    server.mjs                 bundled server, committed
    skills/define/             the entry point on both CLIs
    skills/<copied skills>/    from Agent Skills, now the source of truth for define
    steps/<five steps>.md      step prompts from Runner
    PROVENANCE.md              source commits, and what changed in each copied file
  server/                      TypeScript source, tests, and the esbuild build
```

The Claude Code entry point is the `define` skill. A `commands/define.md` with the same name made Claude Code list `/define-openspec-change:define` twice, so there is no separate command.

## Development

```sh
cd spec-driven-workflows/openspec/server
npm install
npm run build   # writes ../plugin/server.mjs
npm run check   # typecheck, bundle-matches-build check, tests
```

Commit `plugin/server.mjs` with any change to `server/src`.
