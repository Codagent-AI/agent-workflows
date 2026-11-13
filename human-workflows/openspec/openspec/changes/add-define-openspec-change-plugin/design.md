# Design

## Context

This design describes what the branch built. See `proposal.md` for the motivation and `specs/` for the behavior.

The plugin runs inside a person's own Claude Code or Codex session. It cannot drive the agent. It can only answer tool calls, so the order of steps is enforced by what `next_step` returns and refuses. Codex and Claude Code copy only `plugin/` into their plugin cache, so nothing outside it exists at run time. Where the skills and prompts were copied from is recorded in `plugin/PROVENANCE.md`.

## Goals / Non-Goals

**Goals:**

- Keep the step order and the step prompts in data (`workflow.yaml`), and keep the checks in code.
- Make a define resumable across sessions and across CLIs.
- Keep the crosscheck read-only and unable to call back into the define.
- Fit the limits of both hosts, such as Codex's 60 second tool-call limit and its environment filtering.

**Non-Goals:**

- Checking that the agent did the work inside a step, such as that it ran the review. The server checks files, not behavior.
- Planning tasks or implementing the change.
- Windows support.
- Follow-up questions to a finished child. Each call starts a fresh child.

## Decisions

### Steps and prompts live in `workflow.yaml`

The workflow file holds the name, description, an ordered list of steps with an id, a prompt, and optional `tools: [call_agent]`, and `shared_prompts`: text written once that the server adds after a step's own prompt, `call_agent` for the steps that run a review and `every_step` for all of them. The server validates it with zod at startup and exits on a bad file. Only `{{change_name}}` and `{{reviews_dir}}` are allowed.

The artifact check for a step stays in `server/src/checks.ts`, in one table keyed by step id. The table also feeds the finish check and the pull request's file list. A test pins the shipped step ids so a rename cannot drop a check.

Alternative: hard-code prompts in the server. Rejected so prompts can change without a rebuild of logic, and so a reader sees the whole flow in one file. Alternative: put the checks in the YAML. Rejected because a check is code, and a typo in YAML would silently remove it.

### One tool, `next_step`, for start, resume, advance, and finish

`start: true` creates or resumes. A call without `start` completes the current step. A new session therefore cannot skip a step by mistake, because completing needs the saved current step. The last completion runs the finish. This keeps the agent's interface to one call to repeat.

Alternative: separate `start`, `complete`, and `finish` tools. Not chosen; the code gives no reason.

### State is a JSON file in the change folder

`.define-openspec-change.json` is committed with the change. It is validated whole on every read and written by a temporary file and rename. A broken file is refused, not rewritten. Putting state in the repository, not in the user's home, lets either CLI resume and lets a teammate see how the change was defined.

Alternative: state in the log folder. Rejected because it would not follow the repository to another machine or CLI.

### Files are checked by the server and by OpenSpec

OpenSpec counts any existing file as done, so the server also requires a non-empty file. For proposal, specs, and design it then asks `openspec status --json` as well. `test-plan.md` is not an OpenSpec artifact, so only the file check applies.

### The crosscheck is a child process of the server

`call_agent` spawns `codex exec` or `claude -p` in its own process group, with stdout and stderr to files and the prompt on stdin. Stdin keeps the prompt out of the process list and avoids argument size limits.

Read-only is enforced differently per CLI. Codex uses its read-only sandbox. Claude gets a fixed tool list and no settings, plugins, or MCP servers. Codex still loads the user's own configuration, so the server also sets `DEFINE_OPENSPEC_CHANGE_CHILD=1`, and a server that sees it registers no tools. This works however the child loads the plugin.

Alternative: use the host's own subagents. Rejected because they run on the same vendor, and the point is a second vendor's view.

### A gate keeps `next_step` and `call_agent` apart

A call refuses to start while `next_step` runs, and `next_step` refuses while a call starts or runs. The `starting` flag is set before the first await so overlapping starts cannot both pass. This stops a review from running against a step that is advancing or being committed, and keeps each call recorded against the right change.

### Waiting is short and polled

`call_agent` and `get_agent_call` wait 50 seconds, under the 60 seconds Codex allows by default, then return `running`. The lead polls. A 60 minute limit, SIGTERM then SIGKILL after 10 seconds, and a kill-all on server exit bound a child's life.

### A working-tree fingerprint reports child writes

Before and after a call the server hashes `git status`, the tracked diff, and untracked file contents, and reports `unchanged`, `changed`, or `unknown`. It reports; it does not undo anything.

### The commit touches only the change folder

Finish runs `git add` and `git commit -- <dir>`, so other staged work is not swept in. Before it, it records the staged entries under the folder. On failure it restores them and the old state text. Unmerged paths are refused first because restoring the index cannot bring conflict stages back. After the commit, the result lists other dirty paths.

Publishing is skipped on the default branch, a detached HEAD, or an unknown default. Elsewhere it pushes and runs `gh pr create`. A failure is reported once.

### Two hosts, two ways to find the session directory

Claude Code sets `CLAUDE_PROJECT_DIR`. Codex starts the server in the plugin folder, so the server declares an experimental capability and reads the directory from each call's `_meta`. `.codex-mcp.json` is used instead of Codex's portable `mcp.json` because only `env_vars` forwards the user's environment; the portable form passes `${VAR}` as literal text.

### Skills carry the conversation, the server carries the rules

Skills (`define`, `setup`, `propose`, `spec`, `design`, `test-plan`, `call-agent`, `ask-questions`) tell the agent how to talk with the person. The `define` skill sets `disable-model-invocation: true`, and there is no `commands/define.md`, because a command with the same name listed the entry twice on Claude Code.

### Approach-review has no file check

The step revises the earlier documents and writes no file of its own, so there is nothing new to check. The finish validation covers the documents it changed.

### The lead is found from the client

The lead is the MCP client's name, with `CLAUDECODE` as a fallback. Only Claude Code and Codex are supported. Any other client gets no lead, and the crosscheck uses the first configured entry that is installed.

### Setup suggests defaults and asks

The `setup` skill suggests `gpt-6-astra` for Codex and `opus` for Claude, at high effort. It shows them and asks before writing, and the user can change either. Revisit them when either vendor's default model moves on.

### Node.js 26 minimum

The plugin targets Node.js 26, the current LTS line, and the build target matches the `engines` field.

## Risks / Trade-offs

- [The server cannot see whether the agent ran the crosscheck or told the user] -> The step prompts and the `call-agent` skill require it, and the README says the code checks files only.
- [A Codex child still loads the user's Codex configuration, including its MCP servers, plugins, and hooks] -> The read-only sandbox covers shell and file edits only. The working-tree fingerprint reports a change after the fact.
- [Codex 0.166 ignores the quoted TOML key for enabling the plugin and does not expand `${CLAUDE_PLUGIN_ROOT}`] -> The README documents the unquoted key, and the Codex manifest uses a relative command with `cwd: "."`.
- [A define on a dirty tree, or on `main`, is allowed] -> The commit is scoped to the change folder and the result lists what was left out.
- [`openspec new change` may create `openspec/config.yaml` outside the folder] -> It is left uncommitted and named in the result.
- [The bundle is a large committed file] -> `npm run check` fails when it differs from a fresh build.
- [Biome and jscpd limits are strict] -> Code is restructured to fit. Limits are not raised and no suppression comments are used.

## Migration Plan

New plugin, no migration. Install from a clone through each CLI's marketplace command. To roll back, uninstall the plugin; committed change folders and their state files remain and are harmless. A change that was defined with an older state schema would be refused by the schema check, since the schema is version 1.

## Open Questions

- Should the crosscheck answer be recorded in the state file? Only the call's metadata is recorded, so a session that resumes after a review no longer has its answer.
- The Claude child gets `WebSearch`, while the Codex child's web access is left to its sandbox defaults. Should the two reviewers have the same access?
