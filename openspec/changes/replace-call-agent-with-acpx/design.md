## Context

The define-openspec-change MCP server (`human-workflows/openspec/server/src`) runs crosschecks through `call_agent`, `get_agent_call` and `cancel_agent_call`:

- `agentcall.ts` holds `CallManager`:
  - `start`: the synchronous refusals in `startRefusal`, then the `starting` flag, `planStart`, `prepareChild`, and registering the call with a working-tree fingerprint;
  - `launch`, `wait`, `get`, `cancel` and `killAll`;
  - `terminate`: SIGTERM to the child's process group, then SIGKILL after `KILL_GRACE_MS`, 10 s;
  - `settle`: the fingerprint after, the outcome, the log, the record.
  - `MAX_CALL_MS` is 60 minutes and `SHUTDOWN_GRACE_MS` is 3 s. A `Gate` keeps `next_step` and a starting call apart.
- `child.ts` builds Claude and Codex command lines. `callchild.ts` writes the prompt and command to a private log folder and spawns the child detached, under a random `call-<8 hex>` id. `calloutcome.ts` parses each CLI's output, caps the answer at 200,000 characters, and reads Claude's cost. `call.ts` builds the result and sets the MCP `isError` flag when the call failed.
- `callowner.ts` ties a call to the one define at a step marked `tools: [call_agent]`, and `callrecord.ts` appends to the state file's `calls`.
- `config.ts` reads `human-workflows.crosscheck` from `~/.agent-workflows/config.yaml`, with `cli` limited to `claude` and `codex`.
- `steps.ts` reads `plugin/workflow.yaml`: a `tools` marker per step, `shared_prompts` with `call_agent` and `every_step`, and the placeholders `{{change_name}}` and `{{reviews_dir}}`. Steps are parsed with a non-strict schema, so unknown step keys are dropped.
- `worktree.ts` hashes `git status --porcelain=v1 -uall`, `git diff HEAD --binary` and untracked file contents into one fingerprint.
- `context.ts` resolves the session's working folder for each call: `CLAUDE_PROJECT_DIR` on Claude Code, and the tool call's `sandboxCwd` on Codex, which starts the server in the plugin folder.

acpx 0.23.0 facts this design relies on, checked on November 27:

- **Command:** `acpx [global flags] <agent> exec [-f -] [--config-option key=value]...` runs one prompt in a new session. `--agent "<command>"` runs a raw ACP command instead of a built-in agent name.
- **Output:**
  - `--format json` writes each ACP JSON-RPC message, inbound and outbound, as one line on stdout.
  - `--json-strict` keeps stderr free of non-JSON text.
  - `--suppress-reads` leaves file contents out of read results.
- **Permissions:** `--approve-all` approves every permission request and every client file write.
- **Time limit:** `--timeout <seconds>` overrides a timeout set in acpx's config.
- **Exit codes:** 0 success, 1 error, 2 usage, 3 timeout, 4 no session, 5 permission denied, 130 interrupted.
- **File reads:** acpx's own file handler refuses any path outside `--cwd` ("Path is outside allowed cwd subtree"), whatever the permission mode.
- **Processes:**
  - acpx spawns its agent in acpx's own process group.
  - It spawns the commands it runs for the agent (ACP terminals) and its command probes with `detached: true`, each in a new process group.
  - On SIGTERM it cancels the prompt (up to 2.5 s), then cleans up the agent (up to 8 s).
- **Config files:** acpx reads `~/.acpx/config.json` and `<cwd>/.acpxrc.json`. Either can set a timeout, replace an agent's command, add MCP servers, or set `disableExec`. A flag overrides the setting it names.
- **Adapters:**
  - The built-in `claude` and `codex` agents run through npx adapters.
  - The Claude adapter takes the config option `effort`. acpx's Claude profile loads the project's and the local Claude settings, not the user's, unless `ACPX_CLAUDE_INCLUDE_USER_SETTINGS=1` is set.
  - The Codex adapter takes `reasoning_effort` when the selected model has effort levels, and rejects a value the model doesn't support. At `gpt-6-astra` it offered low, medium, high, xhigh, max and ultra.
  - `agy acp` takes `thought_level`.
- **Models:** the adapters listed the configured models (`opus` for Claude, `gpt-6-astra` for Codex), and agy lists `gemini-4-neon`.
- **A live run:** a Neon review run with the command below, through `agy acp`:
  - stopped with `end_turn`;
  - wrote 104 `tool_call` and 216 `tool_call_update` notifications;
  - gave its whole review in the text after the last tool call.

## Goals / Non-Goals

**Goals:**

- One launcher for every reviewer, through acpx, with the server's supervision unchanged.
- A list of reviewers that run at the same time, chosen by the lead-vendor rule.
- A `crosscheck` tool usable at any time, which sends exactly the lead's prompt.
- A result that names each reviewer and lists changed paths.
- State files written before the change keep loading.

**Non-Goals:**

- acpx sessions, flows or queue owners.
- Checking agent names against acpx's registry.
- Restoring a file a reviewer changed.
- Cost figures.

## Approach

### Flow

```
lead ── crosscheck(prompt, change_name?) ──► CrosscheckManager
         synchronous refusals: empty prompt │ crosscheck starting or running │ next_step running
         mark starting
         refusals: acpx < 0.23 or missing │ no usable config │ named define not in progress
         choose reviewers (lead-vendor rule)
         snapshot working tree
         for each reviewer: write prompt.txt, command.json; spawn acpx detached, prompt on stdin
         wait up to 50 s ──► result, or `running` + crosscheck_id
lead ── get_crosscheck(id) ──► wait up to 50 s ──► result, or `running`
all reviewers ended ──► snapshot, compare, overall status, log, record in the named define
```

### Tools

| Tool | Input | Annotations |
|---|---|---|
| `crosscheck` | `prompt` (required, non-empty), `change_name` (optional) | not read-only, not destructive, not idempotent, open world |
| `get_crosscheck` | `crosscheck_id` | read-only, closed world |
| `cancel_crosscheck` | `crosscheck_id` | not read-only, not destructive, idempotent, closed world |

The `crosscheck` description says to use it only when a review step or the crosscheck skill asks. No tool adds text to the prompt.

`change_name` names the define to record the crosscheck in:

- It must name a define in progress, or the call is refused.
- Without it, nothing is recorded in any state file.
- Logs are written either way.
- The define's current step is recorded with the crosscheck.

### Refusals

Each refusal returns an error code and message. A refusal for config or acpx ends with `SETUP_HINT`. The checks run in this order.

These run before the first `await`, as `startRefusal` does today:

1. An empty prompt.
2. A crosscheck starting or running. The refusal names its id.
3. `next_step` running (the `Gate`).

Then the manager marks itself starting, so an overlapping call is refused by check 2, and runs the rest:

4. acpx missing or older than 0.23: `crosscheck_not_configured`, naming acpx and 0.23.
5. Config missing or invalid, or no reviewer available: `crosscheck_not_configured`.
6. `change_name` given and not a define in progress.

`next_step` with `start: true` runs checks 4 and 5 before creating the change folder, as today.

The acpx check runs `acpx --version` and compares semver. A passing result is cached for the server's life; a failing one is not, so installing acpx mid-session works without a restart.

### Config

`config.ts` entries become `{ cli, model?, effort? }`:

- `cli` must match `^[a-z][a-z0-9-]*$`. The pattern covers every acpx built-in name, and keeps a `cli` value from ever being taken as a raw command.
- Names are not checked against acpx's list.
- An empty list, a repeated `cli`, or an unknown key is still invalid.
- `effort` defaults to `high`.

### Choosing reviewers

`chooseCrosscheck(entries, leadCli, env)`:

- returns every available entry whose `cli` differs from the lead's;
- if none is available, returns the lead's own entry, if that one is available;
- if the lead is unknown, returns every available entry.

The lead is found as today, from the client name and then the Claude environment marker.

Availability:

- `claude`, `codex`, `agy`: the CLI is on `PATH` (the existing `onPath`).
- Any other name: available. If acpx can't start it, that reviewer fails with acpx's message.

### Launching a reviewer

The new `acpx.ts` builds one launch per reviewer:

```
acpx --format json --json-strict --suppress-reads --approve-all --timeout 3660 --cwd <folder>
     [--model <model>] (<cli> | --agent "agy acp") exec -f - [--config-option <key>=<effort>]
```

| `cli` | Agent argument | Effort | Effort applied |
|---|---|---|---|
| `claude` | `claude` | `--config-option effort=<effort>` | yes |
| `codex` | `codex` | `--config-option reasoning_effort=<effort>` | yes |
| `agy` | `--agent "agy acp"` | `--config-option thought_level=<effort>` | yes |
| other | `<cli>` | none | no |

- **Model:** `--model` is passed only when the entry has a model. acpx refuses a model the agent doesn't list, and an adapter refuses an effort its model doesn't support. Either shows as that reviewer failing, with the agent's message.
- **Time limit:** `--timeout 3660` is a minute past the server's 60-minute limit. A timeout in acpx's config can't end a review early, and the server's own limit still ends it first.
- **Folder:** `<folder>` is the repository root, or, outside a git repository, the session's working folder resolved for the call. It is never the server's own folder.
- **Config files:** acpx's own config files apply and are honored: an agent command, MCP server or `disableExec` set in `~/.acpx/config.json` or the repository's `.acpxrc.json`. The flags above override the settings they name.
- **Environment:** the lead's Claude session variables are removed (the list in `child.ts` moves to `acpx.ts`), and `DEFINE_OPENSPEC_CHANGE_CHILD=1` is set. Nothing else is added.
- **Spawn:** `callchild.ts` keeps its job:
  - it writes `prompt.txt` and `command.json` (mode 600) to the reviewer's folder in the private log tree;
  - it spawns acpx detached, with the prompt on stdin, so acpx leads a new process group;
  - it sends stdout to `events.ndjson` and stderr to `stderr.txt`;
  - the prompt never appears in the arguments.

### Reading a reviewer's result

`reviewoutcome.ts` replaces `calloutcome.ts`. It reads `events.ndjson` line by line and skips lines that aren't JSON.

- **Answer:**
  - The text of `session/update` notifications whose `update.sessionUpdate` is `agent_message_chunk` with text content, joined in order.
  - The text starts over at each `tool_call`, but not at a `tool_call_update`, since the Claude adapter can send an update for a background task after the final message. That drops narration before tool use.
  - If no text follows the last `tool_call`, the answer is the last stretch of text that has any.
  - The answer is capped at 200,000 characters, with a note when cut.
- **Stop reason:** the `result.stopReason` of the response whose id matches the outbound `session/prompt` request's id. Any response carrying a `stopReason` is the fallback.
- **Errors:** from the last JSON-RPC error response, `error.data.details` when present, else `error.message`, plus the tail of `stderr.txt`. Earlier errors that the turn recovered from are left out.

Outcome, checked in this order:

| Condition | Status | Code |
|---|---|---|
| hit the 60-minute limit | `failed` | `timeout` |
| cancel requested | `canceled` | |
| spawn failed | `failed` | `launch_failed` |
| acpx exit code 3 | `failed` | `timeout` |
| exit code not 0 | `failed` | `execution_failed`, with acpx's error and exit code |
| exit 0 with no stop reason | `failed` | `execution_failed` |
| stop reason not `end_turn` | `failed` | `stopped`, with the stop reason |
| empty answer | `failed` | `empty_answer` |
| otherwise | `succeeded` | |

### Result

```json
{
  "status": "succeeded | failed | canceled | running",
  "crosscheck_id": "cc-3f9a1c2e",
  "elapsed": "6m 12s",
  "working_tree": "unchanged | changed | unknown",
  "changed_paths": ["openspec/changes/x/proposal.md"],
  "reviewers": [
    { "cli": "codex", "model": "gpt-6-astra", "effort": "high", "status": "succeeded", "elapsed": "4m 50s", "response": "..." },
    { "cli": "agy", "model": "gemini-4-neon", "effort": "high", "status": "failed", "elapsed": "60m 0s", "code": "timeout", "error": "..." }
  ],
  "next": "..."
}
```

- **Model and effort:** `model` is `default` when the entry has none. `effort` reads `not applied (<effort>)` when it wasn't applied.
- **While running:**
  - each reviewer shows `running` or its end status, and its elapsed time;
  - there is no `response`, `working_tree` or `changed_paths`;
  - a note says the result is not the answer.
- **Each reviewer settles on its own exit.** A cancel or the 60-minute limit marks only the reviewers still running. A reviewer that already finished keeps its status and its `response`, also in a `canceled` result.
- **Overall status:** `succeeded` only when every reviewer succeeded; `canceled` after `cancel_crosscheck`; otherwise `failed`.
- `changed_paths` appears only when `working_tree` is `changed`.
- **MCP `isError`:** set for a refusal and for a finished crosscheck in which no reviewer succeeded. A `failed` crosscheck with at least one `response` is not marked as an error, so a client doesn't set the good review aside.

### Working tree

`worktree.ts` replaces the single hash with a snapshot:

- `head`: `git rev-parse HEAD`.
- `paths`: one entry for each path that `git status --porcelain=v1 -z -uall` lists. A rename or copy record (`R` or `C` in either column) is followed by its source path in a second NUL-terminated field, and both paths get an entry. Each entry holds:
  - the status code;
  - the index entry's mode and object id, from `git ls-files -s -z` for those paths, or none;
  - the working-tree file's type, mode and content hash: a symlink's target, or a missing file as missing.

Comparing the two snapshots gives the changed paths:

- every path whose entry was added, removed, or changed;
- if `head` moved, `HEAD` and the paths from `git diff --name-only <before> <after>`.

The paths are sorted and unique. If either snapshot fails, `working_tree` is `unknown` and no paths are listed. The first snapshot is taken before any reviewer starts, the second after the last one ends.

Today's check misses some changes. The snapshot also catches:

- a mode change on a file that was already modified;
- a staged-only edit to a file whose status code doesn't change;
- a rename.

### Stopping reviewers

`terminate` stops one reviewer:

1. List acpx's descendants with `ps -A -o pid=,ppid=,pgid=` before sending any signal, and record their process groups along with acpx's own. Groups that hold the server's own process are left out.
2. Send SIGTERM to acpx's pid only. acpx then cancels the prompt and closes its agent, which can take it up to 10.5 s.
3. After `KILL_GRACE_MS`, now 15 s, list descendants again if acpx is still alive. Then send SIGKILL to every recorded process group that still exists, even if acpx has exited.

This reaches the commands acpx detached for the agent, which a reparented process would otherwise hide from a later search. Cancel, the time limit and server exit all use it. Server exit keeps its 3 s grace before the SIGKILL step.

### Process manager

`CrosscheckManager` replaces `CallManager` in `crosscheck.ts`, keeping its structure.

- A `Crosscheck` holds:
  - its id;
  - the folder, and the optional define and step;
  - its times and status;
  - the before snapshot and the result;
  - a list of `Reviewer`s.
- Each `Reviewer` holds its entry, folder, child, times, status, code, error, response, and its own kill timer.
- The 60-minute limit timer belongs to the crosscheck.
- The crosscheck settles when every reviewer has settled.
- Ids are `cc-<8 hex>` from `randomBytes`, as today.

### Logs

The private log tree keeps its modes: folders 700, files 600. For each crosscheck:

- One folder under the repository's folder, created with an exclusive `mkdir`. If the folder already exists, a new id is drawn, so two servers on one repository, or a restarted server, never share a folder.
- One subfolder per reviewer, `<n>-<cli>`, holding `prompt.txt`, `command.json`, `events.ndjson`, `stderr.txt` and `response.txt`.
- `crosscheck_start` and `crosscheck_end` events go to the existing event log.

### State file

`state.ts` gains `crosschecks`, a list of `{ crosscheck_id, step, status, working_tree, started_at, ended_at, reviewers: [{ cli, model?, effort, effort_applied, status, code? }] }`.

- `calls` becomes optional. A file that has it keeps it in its old form and writes it back unchanged, and a new file has only `crosschecks: []`.
- A file without `crosschecks` reads as an empty list.
- `schema` stays `1`, because both keys are optional when reading.
- Changed paths are not recorded.

### Workflow file and placeholders

- `steps.ts` drops the `tools` key and the `call_agent` shared prompt, and `shared_prompts` accepts only `every_step`. The step schema stays non-strict, so a leftover `tools` key is ignored.
- `{{reviews_dir}}` goes. `{{review:<file>}}` is replaced with the text of `<file>` in the plugin's `reviews/` folder.
- `<file>` must be a plain file name ending in `.md`, with no path separators. The server reads every named file at startup, and refuses to start if one is missing. The texts are cached for the server's life.
- The proposal and approach-review prompts carry, in their own words:
  - when to call `crosscheck`;
  - what its prompt must hold: the review instructions through `{{review:...}}`, what to review, a strict instruction to change nothing, and `change_name`;
  - that the lead discusses consequential findings with the user before changing an artifact.

### Skills, setup and packaging

- **The crosscheck skill.** `skills/crosscheck/SKILL.md` replaces `skills/call-agent/`.
  - It has `disable-model-invocation: true`, and an `agents/openai.yaml` with `policy: { allow_implicit_invocation: false }`.
  - It is generic: write a self-contained prompt that strictly tells reviewers to change nothing; call `crosscheck` and poll `get_crosscheck`; check each finding; report one combined result that names any failed reviewer and any changed paths.
- **The `setup` skill:**
  - checks `acpx --version`, and gives `npm install -g acpx@latest`, running it only after the user confirms;
  - detects `claude`, `codex` and `agy`, and recommends one entry for each, with agy at `gemini-4-neon` and `high`;
  - writes the list.
- **`.codex-mcp.json`** keeps its current list: the wait setting, the child marker, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, the Anthropic, Bedrock, Vertex, SSH and GitHub settings, and `XDG_CONFIG_HOME`. Codex already passes `PATH` and `HOME`. The list adds:
  - `OPENAI_API_KEY` and `CODEX_API_KEY`, for the Codex adapter;
  - `npm_config_cache`, `npm_config_registry`, `npm_config_userconfig` and their uppercase forms, so acpx's npx can fetch the adapters;
  - `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` and `NODE_EXTRA_CA_CERTS`.
- **The bundle:** `plugin/server.mjs` is rebuilt.

## Decisions

- **The tool sends exactly the lead's prompt.** It adds nothing, as Paul asked. Each review step and the skill carry their own words.
- **`--approve-all` instead of read-only layers.** Paul chose it. Reviewers can run commands, which reviews need, and the prompt tells them to change nothing. The changed paths make any change visible.
- **Review instructions inlined by a placeholder.** acpx refuses reads outside `--cwd`, and an installed plugin's folder is outside the repository.
  - Alternatives considered:
    - The lead reads the file and pastes it. That is an extra read outside the repository, which can prompt in Claude Code, and the lead may paraphrase.
    - `--no-fs`, so agents read with their own tools. Whether each agent then reads outside the repository depends on the agent.
- **Every effort through a config option.** Claude's `effort`, Codex's `reasoning_effort` and agy's `thought_level` are all set the same way, after the model.
  - The adapter checks the value, so an effort the model doesn't support fails that reviewer visibly instead of being dropped.
  - `CODEX_CONFIG` was considered and rejected. It would overwrite a user's own `CODEX_CONFIG`, and the adapter would quietly fall back to the model's default effort.
- **acpx's config files are honored.** The user's `~/.acpx/config.json` can tailor agents, and under `--approve-all` a repository can already steer a reviewer through its files.
  - The one setting that could cut reviews short, the timeout, is overridden.
  - Refusing to run in a repository with an `.acpxrc.json` was considered and rejected: it would block repositories that use acpx themselves.
- **No registry check on names.** Only the pattern is checked, so the config keeps working as acpx adds agents. A bad name fails as one reviewer, next to the others' results.
- **Answers only when the crosscheck ends.** The lead reports one combined result anyway.
- **Process groups recorded before any signal.** acpx detaches the commands it runs for the agent. If acpx exits first, those processes are reparented, and a search after the grace period would no longer find them.
- **Random ids.** Several servers can run on one repository, and a restarted server must not reuse a log folder.
- **Same state schema version.** Both keys are optional when reading, so files written before and after the change both load.

## Risks / Trade-offs

- **acpx is alpha.**
  - Risk: its JSON messages or flags change.
  - Mitigation: require 0.23 or later; read events defensively, skipping unknown lines and fields; model the fake `acpx` in the tests on 0.23's output.
- **Reviewers can write.** Accepted. The result lists changed paths, but uncommitted work a reviewer overwrote is not restored, and pushes or writes outside the repository aren't seen.
- **A repository's acpx config applies.**
  - What it can do: an `.acpxrc.json` in the reviewed repository can replace a reviewer's command, add MCP servers to it, or turn off `exec`.
  - Accepted: an `exec` turned off shows as the reviewer failing with acpx's message.
- **Claude reviewers load the repository's Claude settings.**
  - acpx's Claude profile loads the project's and the local settings, hooks and MCP servers included, but not the user's.
  - A user whose Claude sign-in depends on user settings, such as an `apiKeyHelper`, sees Claude reviews fail until they set `ACPX_CLAUDE_INCLUDE_USER_SETTINGS=1`.
- **Answer extraction can drop text.** An agent that writes part of its review, calls a tool, and then writes the rest returns only the rest. The full event log is in the reviewer's folder.
- **npx adapters.** The first Claude or Codex review on a machine downloads its adapter and runs slower. The 60-minute limit covers it.
- **Codex's variable list.** An agent added later needs its credential variables in `.codex-mcp.json`.

## Migration Plan

- One release. The old tools and the `call-agent` skill go in the same change.
- Users install acpx (the `setup` skill offers it). The existing config entries stay valid, and setup offers an agy entry.
- A define in progress continues. Its old `calls` entries stay as they were, and new crosschecks go in `crosschecks`.
- Rollback: reinstall the previous plugin version. Its schema requires `calls`, so a define started on the new version won't load on the old one until `"calls": []` is added. The old version drops `crosschecks` on its next write.

## Verification

Tests go in the existing suites: `agentcall.test.ts`, `define.test.ts`, `finish.test.ts` and `bundle.test.ts`, with helpers in `helpers.ts`.

- A fake `acpx` script on `PATH` records its arguments, environment and stdin.
- On cue it writes scripted 0.23-style JSON lines, exits with a code, hangs, ignores SIGTERM, or starts grandchildren, one in its group and one detached.
- `test-plan.md` sets the details.
