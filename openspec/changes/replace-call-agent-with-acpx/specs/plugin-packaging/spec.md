## MODIFIED Requirements

### Requirement: Codex receives the variables the server needs
The system SHALL list in `.codex-mcp.json` the variables that acpx, the agents it starts, git, and `gh` need, including the wait setting and the child marker.

#### Scenario: Forwarded variables
- **WHEN** Codex starts the server
- **THEN** variables such as `GH_TOKEN`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, and the Bedrock and Vertex settings are passed through when set

### Requirement: The setup skill recommends entries
The system SHALL ship a `setup` skill that finds which of `claude`, `codex`, and `agy` are installed and recommends one entry for each.

#### Scenario: One CLI
- **WHEN** only one CLI is installed
- **THEN** the skill says the review will run on the same CLI as the lead

#### Scenario: agy installed
- **WHEN** `agy` is on `PATH`
- **THEN** the skill recommends an agy entry with model `gemini-4-neon` and effort `high`

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

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: call_agent takes only the crosscheck target
**Reason**: The `crosscheck` tool has no target argument.
**Migration**: Drop the `agent` argument.
