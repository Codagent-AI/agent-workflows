# define-openspec-change

A Claude Code and Codex plugin that defines an OpenSpec change in your own session. It takes the change through five steps:

1. proposal
2. specs
3. design
4. test-plan
5. approach-review

A second agent on the other vendor's CLI reviews the proposal and the finished approach. At the end the plugin validates the change and commits its documents.

The steps and their prompts are written in one file, [`plugin/workflow.yaml`](plugin/workflow.yaml). A bundled tool server reads it and returns each step's instructions when the agent calls `next_step`, so the whole define runs in one conversation.

## Requirements

- macOS or Linux. Windows is not supported: the server launches the child CLIs and the `openspec`, `git`, and `gh` commands directly, and does not handle `.cmd` shims or `.exe` lookups.
- Node.js 20 or later on `PATH`. The server is one bundled file, `plugin/server.mjs`, with no install step.
- The `openspec` CLI on `PATH`, in a repository that has an `openspec/` folder.
- git. On a branch other than the default branch, `gh` must also be signed in, so the plugin can open the pull request.
- `claude`, `codex`, or both on `PATH` and signed in. With both, the crosscheck runs on the CLI that is not leading. With one, it runs on that CLI.
- `~/.agent-workflows/config.yaml`, which sets the crosscheck agent. If it's missing, the agent offers to set it up the first time you start a define. See [Configuration](#configuration).

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

1. The agent calls `next_step` with `start: true`. That checks that a crosscheck agent is configured and can run, then runs `openspec new change <name>` and returns the proposal step. If the crosscheck isn't configured, it refuses before creating anything, and the agent runs the `setup` skill with you.
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
- Codex follows your own approval settings for the plugin's tools. The plugin doesn't pre-approve them.
- The last `next_step` call commits, and on a branch it also pushes and opens a pull request.

## The workflow file

`plugin/workflow.yaml` holds the workflow's name, its description, and the steps in order. Each step has an `id` and a `prompt`. A step with `tools: [call_agent]` may start a crosscheck. The prompts can use `{{change_name}}` and `{{skills_dir}}`, which the server fills in.

```yaml
name: define-openspec-change
description: Interactively define a structured change through proposal, specification, design, and testing strategy.

steps:
  - id: proposal
    tools: [call_agent]
    prompt: |
      Help the user write the proposal for OpenSpec change "{{change_name}}". ...
  - id: specs
    prompt: |
      ...
```

The server checks the file when it starts. It refuses to start, and says what is wrong, if the file has no name, description, or steps, repeats a step id, leaves out a prompt, lists a tool other than `call_agent`, or uses another placeholder. The check that a step's file exists before `next_step` moves on is in the server, keyed by step id (`proposal`, `specs`, `design`, and `test-plan`). A step with no check, such as `approach-review`, has nothing to check. A test pins the shipped step ids, so renaming a step cannot silently drop its check.

## The crosscheck

`call_agent` takes `agent: "crosscheck"` and a standalone prompt. When more than one define is in progress it also needs `change_name`, so the call is recorded against the right change. It starts one child agent, waits up to 100 seconds, and returns the child's result or `status: "running"` with a `call_id`. The lead then calls `get_agent_call` until the call ends. Only one call runs at a time, and a call can last at most 60 minutes. `cancel_agent_call` stops it.

The child's CLI, model, and effort come from `~/.agent-workflows/config.yaml` (see [Configuration](#configuration)). It has no access to the lead's conversation and runs read-only:

- **Codex child**:
  - runs `codex exec --json --ephemeral --skip-git-repo-check -s read-only -c model_reasoning_effort="<effort>" [-m <model>]`;
  - has this plugin turned off;
  - still loads your own Codex configuration, including its MCP servers, plugins, and hooks. The read-only sandbox covers shell commands and file edits, not those tools.
- **Claude child**:
  - runs `claude -p --setting-sources "" --strict-mcp-config --no-session-persistence --effort <effort> [--model <model>]`;
  - can use only Read, Grep, Glob, and WebSearch;
  - loads no settings, plugins, or MCP servers.

The child reads the review skill from the plugin folder by absolute path. Each call reports whether the working tree changed while the child ran.

## Configuration

The crosscheck agent is set in `~/.agent-workflows/config.yaml`, with one entry per CLI under `human-workflows.crosscheck`:

```yaml
human-workflows:
  crosscheck:
    - cli: codex
      model: gpt-6-astra
      effort: high
    - cli: claude
      model: opus
      effort: high
factory-workflows: {}
```

- The file has one section per top-level folder of this repo. This plugin reads only `human-workflows.crosscheck`. `factory-workflows` is for the factory workflows and is not read yet. The plugin ignores it and anything else in the file.
- `cli` is `claude` or `codex`, and each CLI appears at most once. `model` and `effort` are optional. Without them the child uses its CLI's default model and `high` effort. No other keys are allowed in an entry.
- For each call, the server uses the entry for the CLI that is not leading, if that CLI is listed and on `PATH`. Otherwise it uses the lead's own entry, so the crosscheck runs on the same CLI as the lead. If the lead can't be told apart, it uses the first listed CLI that is on `PATH`.
- If the file is missing or invalid, or no listed CLI is on `PATH`, `next_step` refuses to start and `call_agent` refuses to run. Either way, the agent then uses the `setup` skill (`/define-openspec-change:setup`, or `$setup` in Codex). That skill finds the CLIs you have, recommends an entry for each, and writes the file once you confirm. You can also run it at any time to change the config.

One environment variable remains, for testing: `DEFINE_OPENSPEC_CHANGE_WAIT_SECONDS` (default `100`) sets how long `call_agent` and `get_agent_call` wait before they return `running`.

Codex passes MCP servers only a few variables, such as `HOME` and `PATH`. `plugin/.codex-mcp.json` forwards that variable through `env_vars`, along with the variables the child CLIs, git, and `gh` need: `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, the Bedrock and Vertex settings that go with them (`AWS_PROFILE`, `AWS_REGION`, `AWS_DEFAULT_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_BEARER_TOKEN_BEDROCK`, `ANTHROPIC_VERTEX_PROJECT_ID`, `CLOUD_ML_REGION`, and `GOOGLE_APPLICATION_CREDENTIALS`), `SSH_AUTH_SOCK`, `GIT_SSH_COMMAND`, `GH_TOKEN`, `GITHUB_TOKEN`, `GH_HOST`, `GH_CONFIG_DIR`, and `XDG_CONFIG_HOME`. Claude Code passes its whole environment to the server.

Logs go to `$TMPDIR/define-openspec-change/`. The folders are readable only by you (mode 700), and so are the files in them:

- `server-starts.log` gets one line each time the server starts.
- `<repo-hash>/events.jsonl` records each tool call.
- `<repo-hash>/<call_id>/` holds each crosscheck's prompt, command, output, and final message.

## How Codex runs the server

Codex 0.166 does not expand `${CLAUDE_PLUGIN_ROOT}` or any other plugin-root variable in a plugin's `.mcp.json`. So the Codex manifest names its own server file, `.codex-mcp.json`, which starts `node ./server.mjs` with `cwd: "."`. That makes Codex start the server in the plugin folder. The server then reads the session's directory from each tool call's `_meta`, which Codex sends as `codex/sandbox-state-meta` and `x-codex-turn-metadata`. Claude Code reads `.mcp.json` and starts the server in the session directory.

## How it behaves

- **No preflight.** Define can run on `main` and on a dirty tree. It still checks the change name, and it refuses a change folder it did not start.
- **Finish.** The last `next_step` validates, then commits only the change folder. On a branch it also pushes and opens a pull request. On the default branch it only commits.
- **The child is read-only.** The reviewer runs in a read-only sandbox or with read-only tools, and its prompt tells it not to write.
- **One crosscheck per call.** There are no `session` or `follow_up` targets. Each call starts a fresh child, and the lead puts follow-up questions in a new call.
- **One agent for every step.** The lead you start with runs every step.
- **Config.** The crosscheck comes from the `human-workflows.crosscheck` list in `~/.agent-workflows/config.yaml`, and the lead is whatever session you start.
- **No task steps.** The workflow ends with approach-review and does not plan tasks.
- **Starting and resuming** both use `next_step` with `start: true`. A later call without `start` completes the current step, so a new session cannot skip a step by mistake.

## Layout

```
human-workflows/openspec/
  README.md
  plugin/                      the installable plugin root
    .claude-plugin/plugin.json
    .codex-plugin/plugin.json  skills, plus .codex-mcp.json for the server
    .mcp.json                  Claude Code: node ${CLAUDE_PLUGIN_ROOT}/server.mjs
    .codex-mcp.json            Codex: node ./server.mjs in the plugin folder
    server.mjs                 bundled server, committed
    skills/define/             the entry point on both CLIs
    skills/setup/              writes ~/.agent-workflows/config.yaml with you
    skills/<other skills>/     the skills the steps use
    workflow.yaml              the steps and their prompts
    PROVENANCE.md              where the skills and the workflow came from
  server/                      TypeScript source, tests, and the esbuild build
```

The Claude Code entry point is the `define` skill. A `commands/define.md` with the same name made Claude Code list `/define-openspec-change:define` twice, so there is no separate command.

## Development

```sh
cd human-workflows/openspec/server
npm install
npm run build   # writes ../plugin/server.mjs
npm run lint    # Biome and jscpd
npm run check   # typecheck, bundle-matches-build check, tests
```

Commit `plugin/server.mjs` with any change to `server/src`.

Biome fails on cognitive complexity over 10, functions over 50 lines, files over 300 lines (500 for tests), more than 4 parameters, and shadowed names, along with its recommended rules. jscpd fails on any repeated block of 50 tokens or more. Fix the code rather than raising a limit or adding an ignore comment.
