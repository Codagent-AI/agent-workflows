# plugin-packaging Specification

## Purpose
Defines how the plugin is installed and started on Claude Code and Codex, how the person begins a define, and what the plugin ships, so one folder works on both CLIs.

## Requirements

### Requirement: The plugin folder is self-contained
The system SHALL ship everything it needs at run time inside `plugin/`, with no `node_modules` and no source.

#### Scenario: Installed copy
- **WHEN** a CLI copies only `plugin/` into its plugin cache
- **THEN** the server, workflow, skills, and review files are all present

### Requirement: The server is one committed bundle
The system SHALL ship the tool server as `plugin/server.mjs`, built from `server/`.

#### Scenario: Bundle
- **WHEN** a CLI starts the server
- **THEN** it runs the one bundled file with no install step

### Requirement: A stale bundle fails the check
The system SHALL fail `npm run check` when the bundle differs from a fresh build.

#### Scenario: Stale bundle
- **WHEN** `server/src` changes and the bundle is not rebuilt
- **THEN** `npm run check` fails and says to rebuild

### Requirement: The version is set in one place
The system SHALL take the version from `plugin/.claude-plugin/plugin.json` and report it from the server.

#### Scenario: Reported version
- **WHEN** the server is built
- **THEN** it reports the manifest's version

### Requirement: A version mismatch stops the build
The system SHALL stop the build when the Codex manifest or `server/package.json` has another version.

#### Scenario: Mismatch
- **WHEN** the Codex manifest has another version
- **THEN** the build exits with an error naming both files

### Requirement: The plugin has one name
The system SHALL give the plugin the name `define-openspec-change` in both manifests and both marketplace files.

#### Scenario: Names
- **WHEN** the manifests and marketplace files are read
- **THEN** the name is the same in all four

### Requirement: The marketplace entry carries no version
The system SHALL leave the version out of the Claude marketplace entry, so the plugin manifest decides.

#### Scenario: No version
- **WHEN** the Claude marketplace entry is read
- **THEN** it has no version field

### Requirement: The repository is a marketplace for both CLIs
The system SHALL make `define-openspec-change@agent-workflows` installable from `human-workflows/openspec/plugin` on both CLIs.

#### Scenario: Marketplace install
- **WHEN** the repository is added as a marketplace on either CLI
- **THEN** the plugin can be installed

### Requirement: The server starts on Claude Code
The system SHALL start the server on Claude Code from `.mcp.json` with the plugin root.

#### Scenario: Claude Code
- **WHEN** Claude Code starts the server
- **THEN** the session directory is `CLAUDE_PROJECT_DIR`

### Requirement: The server starts on Codex
The system SHALL start the server on Codex from `.codex-mcp.json`, in the plugin folder.

#### Scenario: Codex
- **WHEN** Codex starts the server in the plugin folder
- **THEN** the server runs `node ./server.mjs`

### Requirement: On Codex the session directory comes from call metadata
The system SHALL take the session directory from the sandbox state in each call's `_meta` on Codex.

#### Scenario: Codex metadata
- **WHEN** a call carries the sandbox state in `_meta`
- **THEN** the work happens in that directory, not where the server started

### Requirement: Codex receives the variables the server needs
The system SHALL list in `.codex-mcp.json` the variables that acpx, the agents it starts, git, and `gh` need, including the wait setting and the child marker.

#### Scenario: Forwarded variables
- **WHEN** Codex starts the server
- **THEN** variables such as `GH_TOKEN`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, and the Bedrock and Vertex settings are passed through when set

### Requirement: Only the user starts a define on Claude Code
The system SHALL ship a `define` skill with `disable-model-invocation: true`.

#### Scenario: Model invocation
- **WHEN** Claude Code lists skills for the model
- **THEN** `define` is not loaded unless the user types the command

### Requirement: There is no separate define command
The system SHALL NOT ship a command with the same name as the `define` skill.

#### Scenario: One entry
- **WHEN** Claude Code lists the plugin's entries
- **THEN** `/define-openspec-change:define` appears once

### Requirement: The define skill starts the workflow
The system SHALL have the `define` skill call `next_step` with `start: true` and the change name, and carry out each result.

#### Scenario: Starting a define
- **WHEN** the user types `/define-openspec-change:define <name>` on Claude Code or `$define <name>` on Codex
- **THEN** the skill calls `next_step` with that name and carries out each result

### Requirement: The define skill asks for a missing name
The system SHALL have the `define` skill ask for a name rather than invent one.

#### Scenario: No name given
- **WHEN** the user gives no change name
- **THEN** the skill asks for one

### Requirement: The setup skill recommends entries
The system SHALL ship a `setup` skill that finds which of `claude`, `codex`, and `agy` are installed and recommends one entry for each.

#### Scenario: One CLI
- **WHEN** only one CLI is installed
- **THEN** the skill says the review will run on the same CLI as the lead

#### Scenario: agy installed
- **WHEN** `agy` is on `PATH`
- **THEN** the skill recommends an agy entry with model `gemini-4-neon` and effort `high`

### Requirement: The setup skill writes only after confirmation
The system SHALL have the `setup` skill write `~/.agent-workflows/config.yaml` only after the user confirms.

#### Scenario: Unconfirmed
- **WHEN** the user has not confirmed the entries
- **THEN** no file is written

### Requirement: The setup skill keeps the rest of the config
The system SHALL have the `setup` skill change only the `human-workflows.crosscheck` list of an existing file.

#### Scenario: Existing config
- **WHEN** the file already exists
- **THEN** every other key is kept as it was

### Requirement: Step skills are bundled
The system SHALL ship the skills the steps name, `propose`, `spec`, `design`, `test-plan`, and `ask-questions`, and the `crosscheck` skill.

#### Scenario: Skills present
- **WHEN** the plugin folder is read
- **THEN** each of those skills is under `skills/`, and there is no `call-agent` skill

### Requirement: Review instructions are bundled
The system SHALL ship review instruction files for the proposal and the approach, and the review steps SHALL give the lead their text to send to the reviewers inside the prompt, not as a path.

#### Scenario: Review files
- **WHEN** a review step is returned
- **THEN** its text holds the text of its review instructions file, not a path to it

### Requirement: Tools declare their effects
The system SHALL give each tool annotations that say whether it writes, is destructive, is idempotent, and reaches outside the repository.

#### Scenario: Annotations
- **WHEN** the tool list is read
- **THEN** `next_step` is marked destructive, `get_crosscheck` is read-only, and `crosscheck` is not read-only

### Requirement: Internal errors show only the message
The system SHALL show an internal error to the model as its message only, and send the stack to stderr.

#### Scenario: Internal error
- **WHEN** a tool throws unexpectedly
- **THEN** the result is an error with the message, and the stack goes to stderr

### Requirement: The setup skill checks for acpx
The system SHALL have the `setup` skill check that acpx 0.23 or later is installed, and install it only after the user confirms.

#### Scenario: acpx missing
- **WHEN** acpx is not on `PATH` or is older than 0.23
- **THEN** the skill says so and gives the install command

#### Scenario: Unconfirmed install
- **WHEN** the user has not confirmed the install
- **THEN** acpx is not installed

### Requirement: Only the user starts a crosscheck skill
The system SHALL ship a `crosscheck` skill that models cannot start on their own: `disable-model-invocation: true` on Claude Code and implicit invocation turned off on Codex.

#### Scenario: Model invocation on Claude Code
- **WHEN** Claude Code lists skills for the model
- **THEN** `crosscheck` is not loaded unless the user types the command

#### Scenario: Model invocation on Codex
- **WHEN** Codex chooses skills for a task
- **THEN** it does not start `crosscheck` unless the user names it

#### Scenario: Starting a crosscheck
- **WHEN** the user types `/define-openspec-change:crosscheck` on Claude Code or `$crosscheck` on Codex
- **THEN** the skill runs, with or without a define in progress

### Requirement: The crosscheck skill reviews anything
The system SHALL have the `crosscheck` skill review whatever the user names, with no define-specific steps: write a self-contained prompt that strictly tells reviewers not to change anything, call `crosscheck`, wait for the result, check each finding, and report one combined result that includes any failed reviewer.

#### Scenario: A review outside a define
- **WHEN** the user starts the skill and names code, a diff, a document, or a plan to review
- **THEN** the agent runs one crosscheck on it and reports the checked findings and any reviewer that failed
