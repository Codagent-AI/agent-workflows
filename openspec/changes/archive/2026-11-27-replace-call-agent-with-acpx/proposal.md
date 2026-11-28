## Why

The define plugin runs its crosscheck through its own `call_agent` tool:

- It builds each reviewer's command line and reads each reviewer's output by hand, and knows only `claude` and `codex`.
- It runs one reviewer per review step.
- It works only inside the proposal and approach-review steps.

What's wanted instead:

- Gemini 4 Neon, through the local `agy` CLI, reviewing alongside Codex.
- A crosscheck that can be run on anything, outside a define.

Each new CLI means more launch and output code in `call_agent`, with its own flags, output format and failure modes.

acpx is an MIT command-line client for the Agent Client Protocol. It starts about 30 agents from built-in profiles, including Claude and Codex, and any other ACP server as a custom command, such as `agy acp`. It handles models, permission policies, timeouts and output the same way for all of them. On November 27, a full Neon review of this proposal ran through acpx and `agy acp`. Using acpx lets the plugin drop its per-CLI launch code and review with any agent acpx can start, while keeping the supervision it already has.

## What Changes

1. **A slim crosscheck tool replaces call_agent. BREAKING.**
   - `call_agent`, `get_agent_call` and `cancel_agent_call` become `crosscheck`, `get_crosscheck` and `cancel_crosscheck`.
   - `crosscheck` starts every chosen reviewer through acpx at the same time. It returns when all have finished, or after about 50 seconds with an id to wait on.
   - It works at any time, not only in the review steps. One crosscheck runs at a time, and never while `next_step` runs.
   - The code that builds each CLI's command line and reads each CLI's output goes. The supervision stays: the waits, cancelling, the time limit, cleanup when the server exits, private logs, clearing the lead's session variables, and the working-tree check.
   - The tool sends each reviewer exactly the prompt it is given and adds no text of its own.
   - A reviewer that fails, times out or gives an empty answer is reported as failed, next to the other reviewers' results, never dropped.
   - The state file records each crosscheck with each reviewer's result. State files written before the change still load.
2. **A list of reviewers. BREAKING.**
   - `cli` in each `human-workflows.crosscheck` entry can name `claude`, `codex`, `agy`, or another agent acpx starts.
   - Every entry on a CLI other than the lead's runs. The lead's own entry runs only when no other can.
   - The plugin maps `agy` to `agy acp`, and `effort` to each agent's own setting: Claude's `effort`, Codex's `reasoning_effort`, and agy's `thought_level`.
3. **Reviewers can act, and the plugin checks.**
   - Every reviewer runs with acpx approving every request, so it can read, search and run commands like any agent.
   - Review prompts strictly tell reviewers not to change anything.
   - The working-tree check reports any change and lists the changed paths.
   - Reviewers get the review instructions inside their prompt, not as a path, since acpx refuses reads outside the repository for agents that read through it.
4. **A crosscheck skill that only the user starts.**
   - It holds the guidance common to any crosscheck: writing a self-contained prompt that tells reviewers not to change anything, waiting, checking each finding, and reporting one combined result. It works on anything, not only a define. It replaces `call-agent`.
   - It is started with `/define-openspec-change:crosscheck` or `$crosscheck`, at any time. Models can't start it on their own.
   - The proposal and approach-review prompts say for themselves when to run `crosscheck` and with what prompt. Steps lose their tool marker and the shared crosscheck text.
5. **acpx is a requirement.**
   - The plugin needs acpx 0.23 or later on `PATH`. `next_step` still refuses to start a define without a usable config, and now also without acpx.
   - The server builds the exact acpx command. Agents read the acpx skill that ships in the acpx package, found through `npm root -g`, only for anything beyond it.
   - The `setup` skill checks that acpx is installed, offers to install it, offers agy entries, and writes the new list.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `crosscheck-review`:
  - The tool runs a list of reviewers through acpx at the same time, at any time, not only in the review steps.
  - Choosing reviewers, the config, effort, permissions, and how failures are reported change.
  - The requirements for launching Claude and Codex directly are replaced.
- `plugin-packaging`:
  - The tools are `next_step`, `crosscheck`, `get_crosscheck` and `cancel_crosscheck`.
  - `crosscheck` replaces `call-agent` in the bundled skills, and the crosscheck skill can't be started by a model.
  - acpx is a requirement, and the `setup` skill and `.codex-mcp.json` change with it.
- `define-step-sequencing`:
  - Steps lose their tool marker and the shared crosscheck text.
  - The start check also requires acpx.
  - The state file's crosscheck records change shape.

## Technical Approach

- **Where it runs:** the server starts acpx, one `exec` per reviewer, as it starts the reviewer CLIs today. The server runs outside Codex's sandbox, so a Codex lead needs no extra approval.
- **The acpx command:** a one-shot `exec` with the prompt on stdin, the model, the effort setting, `--approve-all`, a timeout, and output the server can parse.
- **agy:** a custom acpx agent, `agy acp`, on the signed-in local agy. acpx's built-in Antigravity profile isn't used, because it needs its own runtime and sign-in. Over ACP, agy names the model `gemini-4-neon` and sets effort with `thought_level`.
- **Models:** acpx accepts only a model id the agent lists over ACP. On November 27 the Claude adapter listed `opus` and the Codex adapter listed `gpt-6-astra`, so the current entries keep their models.
- **Working tree:** the server compares each changed path's status, staged state and working-tree content, before and after the whole batch, and lists the paths that changed.
- **Environment:** the server still removes the lead's Claude session variables and sets `DEFINE_OPENSPEC_CHANGE_CHILD=1`, so a reviewer that loads this plugin gets no tools.
- **User start only:** `disable-model-invocation` in Claude Code and `allow_implicit_invocation: false` in Codex keep models from starting the skill. The `crosscheck` tool's description says to use it only when a review step or the crosscheck skill asks.
- **Version:** a minimum acpx version (0.23) is required, since acpx is alpha.

**Risks**

- **Reviewers are no longer read-only by construction.** Only the prompt stops a reviewer from writing. The working-tree check reports a change after it happens, but it can't restore an uncommitted file, and it doesn't see a push, a `gh` command, or a write outside the repository.
- **Codex's server variables grow.** Codex passes an MCP server only the variables `.codex-mcp.json` lists, so each newly supported agent's credential variables must be added there.
- **acpx is alpha.** Its flags and output can change between versions, and its Claude and Codex adapters are fetched through npx.
- **acpx's own config applies.** The plugin honors `~/.acpx/config.json` and a repository's `.acpxrc.json`, which can replace a reviewer's command or add MCP servers to it.
- **Cost reporting goes.** acpx reports tokens, not cost, so Claude reviews lose their cost figure.

## Out of Scope

- acpx flows and persistent sessions.
- Crosschecks in the Archon pack or the factory workflows.
- The text of the review instructions in `reviews/`.
- Moving the crosscheck skill into its own plugin.
- External evaluation harnesses that don't run this plugin.

## Impact

- **Server:**
  - Replaced: the per-CLI command and output code in `child.ts`, `callchild.ts` and `calloutcome.ts`, by one acpx launcher for a list of reviewers.
  - Changed:
    - `config.ts`: any agent, every non-lead entry, and effort.
    - `agentcall.ts` and `server.ts`: the renamed tools, a batch of reviewers, any step.
    - `define.ts`: the start check also needs acpx.
    - `state.ts`: crosscheck records.
    - `steps.ts`: the tool marker and the shared crosscheck text go.
  - Kept: waiting, cancelling, the time limit, cleanup, logs, clearing the environment, and the working-tree fingerprint.
  - Rebuilt: `plugin/server.mjs`.
- **Plugin:**
  - Skills: `crosscheck` added, `call-agent` removed, `setup` and `define` updated.
  - `workflow.yaml` changes.
  - `.codex-mcp.json` keeps `DEFINE_OPENSPEC_CHANGE_CHILD` and `DEFINE_OPENSPEC_CHANGE_WAIT_SECONDS`, and lists the variables each supported agent needs.
- **Docs:** README, the plugin's AGENTS.md and PROVENANCE. The design docs for the plugin and the overview are private claude.ai pages outside the repository. They are updated outside the implementation, which leaves them alone.
- **Dependencies:** acpx 0.23 or later, and the Claude and Codex adapters it fetches through npx. agy must be signed in.
- **User config:** add an agy entry. The existing entries keep their models and effort.
