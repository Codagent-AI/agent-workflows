## Coverage Strategy

Specifications remain the source of unit-test requirements. This plan records only additional
integration and end-to-end obligations, the acceptance testing envelope, and exceptional human-only
obligations.

This change is for the define-openspec-change plugin in `human-workflows/openspec/`. Paths below are relative to that folder.

The plugin has one automated layer: the node tests in `server/test/*.test.ts`, run by `npm run check` in `server/` and by the CI `openspec` job on Linux. They start real subprocesses through fake CLIs on `PATH`, built in `server/test/helpers.ts`, and real git repositories in temporary folders.

- This change adds a fake `acpx` to `helpers.ts`. It replaces the fake `claude` and `codex` reviewers, and plain fake `claude`, `codex` and `agy` executables stay on `PATH` for the availability check.
- The fake answers `--version` with a version set by the test, and records its arguments, the environment variables that start with `CLAUDE`, `CODEX`, `FAKE_` or `DEFINE_`, its working folder, and its stdin.
- It writes acpx 0.23's JSON output, one ACP JSON-RPC message per line. That output has:
  - `session/update` notifications for `agent_message_chunk` text, `tool_call` and `tool_call_update`;
  - the `session/prompt` response with its `stopReason`;
  - a JSON-RPC error response on failure.
- The test scripts it through `FAKE_*` variables to:
  - delay, or exit with a code, including 3 for acpx's timeout;
  - give an empty answer, stop with another reason, or end without a stop reason;
  - send a `tool_call_update` after its final text;
  - put the error's cause in `error.data.details`;
  - write a file;
  - start grandchildren, one in its own process group and one detached;
  - exit promptly on SIGTERM, or ignore it.
- No automated test runs the real acpx or a live agent. CI has neither.

Each risk goes to the cheapest layer that catches it:

- **Unit tests:** config validation, choosing reviewers, the outcome table, answer extraction, and the result's shape.
- **Integration tests:** the subprocess, process-group, git and state-file boundaries, below.
- **E2E-1:** the bundled server over stdio.
- **The acceptance pass:** real acpx and the real agents.

## Integration Tests

### INTEG-1: A reviewer is launched through acpx with the right command, environment and prompt
- Covers: crosscheck-review "Reviewers run through acpx with every request approved", "A reviewer gets only the lead's prompt", "A reviewer does not inherit the lead's session", "agy runs through its ACP server", "Effort goes to each agent's own setting", "Reviewers come from the user's config" (Another acpx agent), "A crosscheck runs at any time" (outside a git repository).
- Boundary: the server spawning acpx as a detached subprocess with an environment, a working folder and stdin.
- Setup: a temporary git repository; a config with one entry each for `claude`, `codex` and `agy`, plus one for another agent name, each with a model and effort; the fake `acpx` on `PATH`; lead Claude session variables such as `CLAUDECODE` and `CLAUDE_CODE_SESSION_ID` set in the server's environment; a prompt over 100 KB.
- Action: run crosschecks under an unknown lead, so every entry runs. Run one more with the session's folder set to a folder that is not a git repository.
- Assertions:
  - every launch has `--format json`, `--json-strict`, `--suppress-reads`, `--approve-all`, `--timeout 3660`, `--cwd <repo root>`, `exec` and `-f -`, and `--model` only when the entry has one;
  - `claude` gets `--config-option effort=<effort>`;
  - `codex` gets `--config-option reasoning_effort=<effort>`;
  - `agy` runs as `--agent "agy acp"` with `--config-option thought_level=<effort>`;
  - the other agent runs by its name, with no effort option, and its result shows effort as not applied;
  - outside a git repository, `--cwd` and the working folder are the session's folder, not the server's;
  - no launch has the lead's Claude session variables, and every launch has `DEFINE_OPENSPEC_CHANGE_CHILD=1`;
  - each stdin equals the lead's prompt byte for byte, and no argument contains it.
- Execution: `server/test/agentcall.test.ts`, `npm run check`, CI `openspec` job.

### INTEG-2: Several reviewers run at once, and the result reports each one
- Covers: crosscheck-review "Every reviewer on another CLI runs", "The review falls back to the lead's CLI", "An unknown lead runs every available entry", "A reviewer is available when its CLI is installed", "The result reports the crosscheck and each reviewer", "A reviewer's answer is returned", "A failed reviewer is reported with its errors", "The crosscheck succeeds only when every reviewer answers", "Waiting returns before the host times out", "One crosscheck runs at a time", "Overlapping starts launch one crosscheck", "crosscheck does not overlap next_step", "Crosscheck logs are private"; define-step-sequencing "next_step does not overlap a crosscheck".
- Boundary: the manager supervising several real acpx processes, the waits, and reading each one's event file.
- Setup:
  - The fake `acpx`, scripted per agent:
    - one answers after a delay;
    - one exits non-zero with a JSON-RPC error whose cause is in `error.data.details`;
    - one exits with code 3;
    - one gives an empty answer;
    - one stops with `max_tokens`;
    - one exits 0 with no stop reason;
    - one answers with text before and after a tool call;
    - one sends a `tool_call_update` after its final text;
    - one writes its review and then calls a tool with no text after it;
    - one answers with more than 200,000 characters.
  - A short wait setting.
  - Configs and leads chosen to exercise each choosing rule, with `agy` absent from `PATH` in one case.
  - Two managers sharing one log base and repository.
- Action: call `crosscheck`, then `get_crosscheck` until the crosscheck ends. Also:
  - send two overlapping `crosscheck` calls, and one with an empty prompt;
  - call `next_step` while a crosscheck runs, and `crosscheck` while `next_step` runs;
  - run a crosscheck in each of the two managers.
- Assertions:
  - two reviewers' recorded start times both come before either one's end;
  - a Claude lead with codex, agy and claude configured runs Codex and agy and no Claude reviewer;
  - with only the lead's CLI available, the lead's entry runs;
  - an unknown lead runs every available entry;
  - a missing `agy` means no agy reviewer, and the others still run;
  - while running, the result is `running` with the crosscheck id, and each reviewer shows its status and elapsed time with no answer;
  - the final result names each reviewer's CLI, model (`default` when unset) and effort;
  - the overall status is `succeeded` only when every reviewer succeeded, and `failed` otherwise;
  - each failing reviewer has the code for its case:
    - `execution_failed`, with the error's details, for a non-zero exit;
    - `timeout` for exit 3;
    - `execution_failed` for exit 0 with no stop reason;
    - `empty_answer`, `stopped` and `launch_failed`;
  - a reviewer still running when another fails finishes and returns its `response`;
  - the response is the text after the last tool call;
  - a trailing `tool_call_update` doesn't clear it;
  - a review followed only by a tool call is still returned;
  - a long response is cut at 200,000 characters with a note;
  - the MCP result is marked as an error only when no reviewer succeeded;
  - of two overlapping calls, one starts reviewers and the other is refused, naming the running crosscheck;
  - an empty prompt is refused;
  - `next_step` and `crosscheck` each refuse while the other runs, and neither starts anything;
  - the two managers' crosschecks get different ids and separate log folders, and neither overwrites the other's files;
  - each reviewer's log folder is mode 700, with mode-600 files.
- Execution: `server/test/agentcall.test.ts`, `npm run check`, CI `openspec` job.

### INTEG-3: Stopping a crosscheck stops acpx and the agent it started
- Covers: crosscheck-review "A crosscheck can be cancelled", "A crosscheck is stopped after 60 minutes", "A timed-out reviewer is reported as a timeout", "A reviewer that ignores termination is killed", "Reviewers do not outlive the server".
- Boundary: POSIX process groups. The server records acpx's group and its descendants' groups before signaling, sends SIGTERM to acpx's pid, and later sends SIGKILL to the recorded groups.
- Setup:
  - The fake `acpx` starts two grandchildren and records all process ids:
    - one in its own process group, as real acpx starts its agent;
    - one with `detached: true`, as real acpx starts a terminal command.
  - Cases:
    - all three ignore SIGTERM;
    - the fake exits promptly on SIGTERM while the detached grandchild ignores it.
  - A two-reviewer crosscheck in which one reviewer has already succeeded.
  - A shortened time limit and kill grace, through the manager's existing test hooks.
- Action: cancel a running crosscheck; let another reach the limit; call the manager's kill-all with one running. Cancel the two-reviewer crosscheck, and let another reach the limit, after one reviewer has succeeded.
- Assertions:
  - after each, neither the fake acpx nor either grandchild is alive (`process.kill(pid, 0)` throws);
  - that includes the detached grandchild after the fake exited promptly;
  - the cancelled reviewers show `canceled`, and later polls show the crosscheck as `canceled`;
  - the reviewers stopped for the limit are `failed` with code `timeout`;
  - a reviewer that had already succeeded keeps `succeeded` and its `response`, in the `canceled` result and in the timed-out one.
- Constraints: must pass on Linux CI and on macOS, so the descendant listing uses only `ps` flags both support.
- Execution: `server/test/agentcall.test.ts`, `npm run check`, CI `openspec` job.

### INTEG-4: Changed paths are found against a real git repository
- Covers: crosscheck-review "The result reports tree changes" (Tree result, A reviewer wrote a file).
- Boundary: the snapshot code running `git` on a real working tree.
- Setup: temporary git repositories with a commit, and a folder that is not a repository. Between the two snapshots, one change each:
  - a tracked file edited;
  - a file added;
  - a tracked file deleted;
  - an edit only staged;
  - a symlink retargeted;
  - a staged rename (`git mv`);
  - a new commit of a changed file;
  - nothing changed.
  - Also, on a file already modified before the first snapshot: an edit; a mode-only change (the executable bit); and, with the file at `MM`, a staged-only edit that leaves the status code and the working-tree file the same.
- Action: snapshot, apply the change, snapshot, compare. One case goes through a crosscheck whose fake `acpx` writes a file.
- Assertions:
  - `working_tree` is `changed` with the exact sorted list of changed paths, or `unchanged` with no list;
  - a new commit lists `HEAD` and the committed file;
  - a rename lists both paths;
  - outside a repository the result is `unknown` with no list;
  - the crosscheck whose reviewer wrote a file reports `changed` and that path.
- Execution: `server/test/agentcall.test.ts`, `npm run check`, CI `openspec` job.

### INTEG-5: Crosschecks are recorded in the define they name, and older state files load
- Covers: crosscheck-review "Finished crosschecks are recorded in the define they name", "Naming a define that is not in progress is refused", "A crosscheck runs at any time"; define-step-sequencing "Progress is saved in the change folder", "An older state file still loads".
- Boundary: the manager writing the change's state file, and `next_step` reading it.
- Setup: a temporary repository with the fake `openspec`. A define in progress at the specs step, with no review marker. A second define whose state file has `calls` entries in the old form. A completed define.
- Action:
  - a crosscheck naming the first define;
  - a crosscheck naming no define;
  - a crosscheck naming the completed define, and one naming a change that doesn't exist;
  - in a folder that is not a git repository, a crosscheck naming no define, and one naming a define;
  - `next_step` on the second define, then a crosscheck naming it.
- Assertions:
  - the first define's state file has one `crosschecks` entry with its current step, the times, the working-tree result, and each reviewer's CLI, model, effort and status;
  - the crosscheck naming no define changes no state file;
  - naming the completed or missing define is refused and starts no reviewer;
  - outside a repository, the crosscheck naming no define runs with `working_tree` `unknown`, and the one naming a define is refused;
  - the second define continues from its current step, its old `calls` entries are unchanged, and its new crosscheck goes in `crosschecks`.
- Execution: `server/test/define.test.ts`, `npm run check`, CI `openspec` job.

### INTEG-6: Without a usable acpx, start and crosscheck are refused, and installing it mid-session works
- Covers: crosscheck-review "Start refuses without a usable crosscheck", "crosscheck refuses without a usable crosscheck", "Refusals point to the setup skill".
- Boundary: the server running `acpx --version` from `PATH`, and the cache of a passing check.
- Setup: a valid config; no `acpx` on `PATH`; then a fake `acpx` that reports `0.22.9`; then one that reports `0.23.0`.
- Action: `next_step` with `start: true`, and `crosscheck`, at each stage in one server.
- Assertions:
  - with acpx missing or at 0.22.9, `start` is refused and no change folder is created;
  - `crosscheck` is refused with `crosscheck_not_configured`, and starts no reviewer;
  - both refusals name acpx with 0.23 and point to the setup skill;
  - once 0.23.0 is on `PATH`, both succeed without restarting the server.
- Execution: `server/test/define.test.ts`, `npm run check`, CI `openspec` job.

### INTEG-7: A review placeholder brings the file's text into the step
- Covers: define-step-sequencing "Step prompts have their placeholders filled", "The workflow file is checked at startup", "Shared step text is written once and added to each step"; plugin-packaging "Review instructions are bundled".
- Boundary: loading `workflow.yaml` and the `reviews/` folder from a plugin root, and `next_step` building the step's text.
- Setup: a temporary plugin root with a workflow whose step uses `{{change_name}}` and `{{review:sample.md}}`, and a `reviews/sample.md` written by the test. Workflows with `{{review:missing.md}}`, with `{{reviews_dir}}`, and with a `call_agent` shared prompt. The shipped `plugin/` folder.
- Action: load each workflow, and return the step.
- Assertions:
  - the returned text holds the change name and the whole of `sample.md` in place of its placeholder, then the `every_step` text once, then the instruction to call `next_step`;
  - each bad workflow stops loading with a message naming the file and the problem;
  - the shipped workflow loads, and every review file it names exists.
  - No assertion checks the wording of a shipped prompt or review file.
- Execution: `server/test/define.test.ts`, `npm run check`, CI `openspec` job.

## End-to-End Tests

### E2E-1: The bundled server runs a crosscheck over stdio
- Covers: plugin-packaging "Tools declare their effects", "Codex receives the variables the server needs"; crosscheck-review "Waiting returns before the host times out", "A crosscheck can be cancelled" and "The result reports the crosscheck and each reviewer" through the public tools, and "A reviewer does not inherit the lead's session" (no tools in a reviewer).
- Surface: the committed `plugin/server.mjs`, started over MCP stdio as Claude Code starts it and as Codex starts it.
- Setup: a temporary git repository; a temporary `HOME` with a config of two non-lead entries; the fake `acpx` and fake CLIs on `PATH`; a short wait setting.
- Journey:
  1. List the tools.
  2. Call `crosscheck` with a prompt that the fake makes slow, and get `running`.
  3. Call `get_crosscheck` until it ends.
  4. Start another crosscheck, call `cancel_crosscheck`, and poll until it shows `canceled`.
  5. Start the server in the plugin folder as Codex does, and call `crosscheck` with tool-call metadata whose `sandboxCwd` is a folder that is not a git repository.
  6. Start the server with `DEFINE_OPENSPEC_CHANGE_CHILD=1` and list its tools.
- Assertions:
  - the tools are exactly `next_step`, `crosscheck`, `get_crosscheck` and `cancel_crosscheck`;
  - `next_step` is destructive, `get_crosscheck` read-only, and `crosscheck` not read-only;
  - the final result has both reviewers with their answers;
  - the cancelled one ends `canceled`;
  - the Codex-style call's reviewer ran with that folder as its working folder and `--cwd`;
  - the reviewer server lists no tools;
  - `.codex-mcp.json` passes the child marker and the wait setting.
- Execution: `server/test/bundle.test.ts`, `npm run check`, CI `openspec` job.

## Acceptance Testing Envelope

- **Environments and sandboxes:**
  - the implementation run's worktree on Paul's Mac, with node and npm through `npm run build`, `npm run lint` and `npm run check` in `server/`;
  - the branch's `plugin/server.mjs`, run directly from a small MCP stdio client script in a temporary folder, presenting itself as Claude Code or as Codex;
  - the real acpx 0.23 at `/opt/homebrew/bin/acpx`;
  - the signed-in `claude`, `codex` and `agy` on `PATH`;
  - every live crosscheck works in a throwaway git repository under a temporary folder.
- **Credentials and secrets:**
  - the agents use their own sign-ins on the Mac: Claude Code, Codex, and agy;
  - the pass doesn't read, print, copy or pass any credential or credential file;
  - it doesn't read `~/.agent-factory/private/`.
- **Authorized effects:**
  - Up to 10 live crosschecks through the real acpx:
    - mostly short prompts at low effort;
    - one at high effort with claude, codex and agy reviewing;
    - one that tells a reviewer to write a file in the throwaway repository, to see the changed paths;
    - one cancelled mid-run, then `ps` checks that no acpx, adapter or agent process from it is left.
  - Up to 2 headless `claude -p --plugin-dir <branch plugin folder>` sessions, to check that a model does not start the crosscheck skill on its own and that `/define-openspec-change:crosscheck` does. If the installed plugin clashes with the branch copy, the check is recorded as not run.
  - Back up `~/.agent-workflows/config.yaml`, add an agy entry (`gemini-4-neon`), and restore the original byte for byte when done, also if the pass fails.
  - npx downloading the Claude and Codex adapters into npm's cache, and acpx writing under `~/.acpx` if it does.
  - Temporary folders and repositories are removed when done, and every process the pass started is stopped.
- **Off limits:**
  - installing, updating or removing acpx, or the define-openspec-change plugin in Paul's Claude Code or Codex; the pass declines the setup skill's install offer;
  - a live crosscheck whose working folder is the run's worktree or any real repository;
  - `~/.agent-workflows/config.yaml` beyond the agy entry and its restore;
  - the factory, its LaunchAgent, its state database and its private folder;
  - any evaluation run, and Chrome or server processes another session started;
  - pushes, branches or pull requests on any repository other than the run's own.
- **Permitted substitutes:**
  - the fake `acpx` wherever a live run adds nothing;
  - if a CLI is not signed in or not installed, its live checks are recorded as not run, never as passed.
- **Known risk areas:**
  - the real acpx event stream against the fake: the answer after the last tool call, the stop reason, and error messages;
  - whether Codex's `reasoning_effort` and agy's `thought_level` take effect, as far as the event log shows the session's config;
  - an effort the model doesn't support, and a Codex entry with no model, failing visibly;
  - acpx's own cleanup on SIGTERM against the 15-second kill grace;
  - a repository's `.acpxrc.json`, and the project and local Claude settings that acpx's Claude profile loads;
  - killing the npx adapter's process tree, where npx starts node, which starts the agent;
  - the first npx download making a review slow;
  - the npm variables in `.codex-mcp.json` reaching acpx under a Codex lead;
  - `ps` flags behaving the same on Linux CI and macOS;
  - acpx refusing reads outside `--cwd`, now that the review instructions travel in the prompt.
- **Accepted limitations:**
  - Reviewers can write. A change is listed after it happens, but an uncommitted file a reviewer overwrote is not restored, and pushes or writes outside the repository are not seen.
  - Review text written before a later tool call is dropped from the answer when more text follows that call.
  - A repository's `.acpxrc.json` is honored, and can replace a reviewer's command.
  - Cost is no longer reported.
  - Codex's setting that stops models from starting the crosscheck skill can be checked live only with the plugin installed in Codex, which is off limits, so the pass records it as unverified.

## Human-Only Testing

None.

## Coverage Map

| Requirement or journey | INTEG | E2E | HUMAN |
| --- | --- | --- | --- |
| crosscheck-review: Reviewers come from the user's config (Another acpx agent) | INTEG-1 | — | — |
| crosscheck-review: Every reviewer on another CLI runs | INTEG-2 | — | — |
| crosscheck-review: The review falls back to the lead's CLI | INTEG-2 | — | — |
| crosscheck-review: An unknown lead runs every available entry | INTEG-2 | — | — |
| crosscheck-review: Start refuses without a usable crosscheck | INTEG-6 | — | — |
| crosscheck-review: crosscheck refuses without a usable crosscheck | INTEG-6 | — | — |
| crosscheck-review: One crosscheck runs at a time | INTEG-2 | — | — |
| crosscheck-review: Overlapping starts launch one crosscheck | INTEG-2 | — | — |
| crosscheck-review: crosscheck does not overlap next_step | INTEG-2 | — | — |
| crosscheck-review: Refusals point to the setup skill | INTEG-6 | — | — |
| crosscheck-review: Reviewers run through acpx with every request approved | INTEG-1 | — | — |
| crosscheck-review: A reviewer gets only the lead's prompt | INTEG-1 | — | — |
| crosscheck-review: A reviewer does not inherit the lead's session | INTEG-1 | E2E-1 | — |
| crosscheck-review: Waiting returns before the host times out | INTEG-2 | E2E-1 | — |
| crosscheck-review: A crosscheck is stopped after 60 minutes | INTEG-3 | — | — |
| crosscheck-review: A crosscheck can be cancelled | INTEG-3 | E2E-1 | — |
| crosscheck-review: A timed-out reviewer is reported as a timeout | INTEG-3 | — | — |
| crosscheck-review: A reviewer that ignores termination is killed | INTEG-3 | — | — |
| crosscheck-review: Reviewers do not outlive the server | INTEG-3 | — | — |
| crosscheck-review: The result reports the crosscheck and each reviewer | INTEG-2 | E2E-1 | — |
| crosscheck-review: A reviewer's answer is returned | INTEG-2 | E2E-1 | — |
| crosscheck-review: A failed reviewer is reported with its errors | INTEG-2 | — | — |
| crosscheck-review: The result reports tree changes | INTEG-4 | — | — |
| crosscheck-review: Finished crosschecks are recorded in the define they name | INTEG-5 | — | — |
| crosscheck-review: Crosscheck logs are private | INTEG-2 | — | — |
| crosscheck-review: A reviewer is available when its CLI is installed | INTEG-2 | — | — |
| crosscheck-review: agy runs through its ACP server | INTEG-1 | — | — |
| crosscheck-review: Effort goes to each agent's own setting | INTEG-1 | — | — |
| crosscheck-review: The crosscheck succeeds only when every reviewer answers | INTEG-2 | — | — |
| crosscheck-review: A crosscheck runs at any time | INTEG-1, INTEG-5 | E2E-1 | — |
| crosscheck-review: Naming a define that is not in progress is refused | INTEG-5 | — | — |
| define-step-sequencing: Step prompts have their placeholders filled | INTEG-7 | — | — |
| define-step-sequencing: Shared step text is written once and added to each step | INTEG-7 | — | — |
| define-step-sequencing: The workflow file is checked at startup | INTEG-7 | — | — |
| define-step-sequencing: Progress is saved in the change folder | INTEG-5 | — | — |
| define-step-sequencing: An older state file still loads | INTEG-5 | — | — |
| define-step-sequencing: next_step does not overlap a crosscheck | INTEG-2 | — | — |
| plugin-packaging: Review instructions are bundled | INTEG-7 | — | — |
| plugin-packaging: Tools declare their effects | — | E2E-1 | — |
| plugin-packaging: Codex receives the variables the server needs | — | E2E-1 | — |
