# crosscheck-review Specification

## Purpose
Defines the independent review that a second agent runs on another CLI during a define: how it is configured, started, limited, waited on, and reported.

## Requirements

### Requirement: Reviewers come from the user's config
The system SHALL read the crosscheck reviewers from `human-workflows.crosscheck` in `~/.agent-workflows/config.yaml`, a list with one entry per reviewer.

#### Scenario: A valid list
- **WHEN** each entry has `cli` naming `claude`, `codex`, `agy`, or another agent acpx can start, and optional `model` and `effort`
- **THEN** the entries are used, and an entry without `effort` gets `high`

#### Scenario: An invalid list
- **WHEN** the list is empty, repeats a CLI, has a key other than `cli`, `model`, and `effort`, or has a `cli` that is not a lowercase letter followed by lowercase letters, digits, and hyphens
- **THEN** the config is reported as invalid with the problem

#### Scenario: Another acpx agent
- **WHEN** an entry names an agent the plugin has no special handling for, such as `gemini`
- **THEN** the entry is accepted without checking acpx's agent list, and the agent is started through acpx by that name

### Requirement: Other config keys are ignored
The system SHALL ignore every key in the config file except `human-workflows.crosscheck`.

#### Scenario: Other sections
- **WHEN** the file also holds `factory-workflows` or other keys under `human-workflows`
- **THEN** they do not change the result

### Requirement: Every reviewer on another CLI runs
The system SHALL run every available entry whose CLI is not the lead's, all at the same time.

#### Scenario: Claude leads
- **WHEN** the config lists `codex`, `agy`, and `claude`, all three are available, and Claude leads
- **THEN** Codex and agy review at the same time, each with its entry's model and effort, and no Claude reviewer runs

### Requirement: The review falls back to the lead's CLI
The system SHALL run the lead's own entry when no entry on another CLI is available.

#### Scenario: Only the lead's CLI
- **WHEN** only the lead's CLI is configured or available
- **THEN** the review runs on the lead's CLI in a separate session

### Requirement: An unknown lead runs every available entry
The system SHALL run every available entry when the lead cannot be told.

#### Scenario: Unknown lead
- **WHEN** the client name is neither Claude nor Codex and the Claude environment marker is not set
- **THEN** every available entry runs

### Requirement: Start refuses without a usable crosscheck
The system SHALL refuse `start` when the config is missing or invalid, no entry is available, or acpx 0.23 or later is not on `PATH`.

#### Scenario: Missing config
- **WHEN** a define is started and the config file does not exist
- **THEN** the call is refused and no change folder is created

#### Scenario: Missing acpx
- **WHEN** a define is started and acpx is not on `PATH` or is older than 0.23
- **THEN** the call is refused, names acpx and the version it needs, and no change folder is created

### Requirement: crosscheck refuses without a usable crosscheck
The system SHALL refuse `crosscheck` when the config is missing or invalid, no entry is available, or acpx 0.23 or later is not on `PATH`.

#### Scenario: No usable config
- **WHEN** `crosscheck` is called and no reviewer can run
- **THEN** the call is refused with the code `crosscheck_not_configured`

#### Scenario: Missing acpx
- **WHEN** `crosscheck` is called and acpx is not on `PATH` or is older than 0.23
- **THEN** the call is refused with the code `crosscheck_not_configured` and names acpx and the version it needs

### Requirement: Refusals point to the setup skill
The system SHALL name the `setup` skill in a refusal caused by the crosscheck config or by acpx.

#### Scenario: Setup hint
- **WHEN** a call is refused for the config or for acpx
- **THEN** the message names the setup skill

### Requirement: A prompt is required
The system SHALL refuse a call with an empty prompt.

#### Scenario: Empty prompt
- **WHEN** the prompt is empty or only spaces
- **THEN** the call is refused with a structured error

### Requirement: One crosscheck runs at a time
The system SHALL refuse `crosscheck` while a crosscheck is running.

#### Scenario: A second call
- **WHEN** a crosscheck is running and `crosscheck` is called again
- **THEN** the call is refused and names the running crosscheck id

### Requirement: Overlapping starts launch one crosscheck
The system SHALL launch one crosscheck when `crosscheck` requests overlap.

#### Scenario: Two at once
- **WHEN** two `crosscheck` requests arrive together
- **THEN** one crosscheck is started and the other request is refused

### Requirement: crosscheck does not overlap next_step
The system SHALL refuse `crosscheck` while `next_step` is running.

#### Scenario: Step in progress
- **WHEN** `next_step` is running and `crosscheck` is called
- **THEN** the call is refused with the code `step_in_progress`

### Requirement: Reviewers run through acpx with every request approved
The system SHALL start each reviewer with a one-shot `acpx exec` that approves every permission request without prompting, so the reviewer can read, search, and run commands.

#### Scenario: A reviewer runs a command
- **WHEN** a reviewer asks permission to run a command
- **THEN** acpx approves it and the reviewer continues

#### Scenario: Codex child
- **WHEN** the reviewer is Codex
- **THEN** acpx starts its built-in `codex` agent with the entry's model, approving every request

#### Scenario: Claude child
- **WHEN** the reviewer is Claude
- **THEN** acpx starts its built-in `claude` agent with the entry's model, approving every request

### Requirement: A reviewer gets only the lead's prompt
The system SHALL give each reviewer exactly the prompt the lead passed, on its stdin, and add no text of its own.

#### Scenario: A long prompt
- **WHEN** the prompt is very long
- **THEN** it reaches each reviewer on stdin and is not in any command's arguments

#### Scenario: No added text
- **WHEN** a crosscheck runs
- **THEN** each reviewer's stdin is the lead's prompt, unchanged

### Requirement: The child cannot reach the define tools
The system SHALL register no tools in a server that sees the child marker in its environment.

#### Scenario: Marked server
- **WHEN** the server starts with `DEFINE_OPENSPEC_CHANGE_CHILD` set
- **THEN** it answers the tool list with no tools

### Requirement: A reviewer does not inherit the lead's session
The system SHALL set the child marker in the environment it starts acpx with, and remove the lead's Claude session variables.

#### Scenario: Child environment
- **WHEN** a reviewer is started
- **THEN** acpx and the agent it starts have `DEFINE_OPENSPEC_CHANGE_CHILD=1` and none of the lead's Claude session variables

### Requirement: Waiting returns before the host times out
The system SHALL wait up to 50 seconds by default in `crosscheck` and `get_crosscheck` before it returns.

#### Scenario: A slow child
- **WHEN** a reviewer is still running after the wait
- **THEN** the result is `running` with a `crosscheck_id` and a note that it is not the answer, and `get_crosscheck` later returns the result

### Requirement: The wait can be set
The system SHALL read the wait length from `DEFINE_OPENSPEC_CHANGE_WAIT_SECONDS` when it is a positive number.

#### Scenario: A set wait
- **WHEN** the variable is set to a positive number
- **THEN** the wait uses that many seconds

### Requirement: A crosscheck is stopped after 60 minutes
The system SHALL stop every reviewer still running when a crosscheck reaches 60 minutes.

#### Scenario: Over the limit
- **WHEN** the crosscheck passes its limit
- **THEN** every reviewer still running is terminated

### Requirement: A timed-out reviewer is reported as a timeout
The system SHALL report a reviewer stopped for the limit as failed with the code `timeout`.

#### Scenario: Timeout status
- **WHEN** a reviewer was stopped for the limit
- **THEN** its status is `failed` with code `timeout`

### Requirement: A crosscheck can be cancelled
The system SHALL stop every running reviewer on `cancel_crosscheck` and report the crosscheck as `canceled`.

#### Scenario: Cancel
- **WHEN** the agent cancels a running crosscheck
- **THEN** every running reviewer stops, those reviewers show `canceled`, and later polls show the crosscheck as `canceled`

### Requirement: A reviewer that ignores termination is killed
The system SHALL end a cancelled or timed-out reviewer with SIGKILL if it is still running after SIGTERM and a grace period.

#### Scenario: Ignored SIGTERM
- **WHEN** a reviewer ignores SIGTERM
- **THEN** it is killed

### Requirement: Reviewers do not outlive the server
The system SHALL stop every running reviewer, with the agent acpx started for it, when the server exits.

#### Scenario: Server shutdown
- **WHEN** the server's stdin closes or it gets SIGTERM or SIGINT
- **THEN** running reviewers and their agents are terminated, and killed if they remain

### Requirement: The result reports the crosscheck and each reviewer
The system SHALL return the crosscheck's status, crosscheck id, and elapsed time, and for each reviewer its CLI, model, effort, status, and elapsed time.

#### Scenario: Call details
- **WHEN** a crosscheck is started or polled
- **THEN** the result holds those fields, with a reviewer's model shown as `default` when none is set and its effort shown as not applied when it was not applied

### Requirement: A reviewer's answer is returned
The system SHALL return a reviewer's answer, capped at 200,000 characters, when it exits cleanly with a non-empty answer.

#### Scenario: A finished call
- **WHEN** a reviewer exits cleanly with an answer
- **THEN** its status is `succeeded` and its response holds the answer

### Requirement: A failed reviewer is reported with its errors
The system SHALL report a reviewer as `failed`, with a code and its errors, when acpx exits non-zero, the answer is empty, or the reviewer cannot start, and SHALL let the other reviewers finish.

#### Scenario: A failed call
- **WHEN** acpx exits non-zero with no answer
- **THEN** that reviewer's status is `failed` with a code and its errors

#### Scenario: An empty answer
- **WHEN** a reviewer exits cleanly with an empty answer
- **THEN** its status is `failed` with a code and its errors

#### Scenario: A model the agent does not offer
- **WHEN** the entry's model is not one the agent offers
- **THEN** that reviewer is `failed` with acpx's message

#### Scenario: One reviewer fails
- **WHEN** one reviewer fails while another is still running
- **THEN** the other reviewer runs to its end and its result is returned next to the failure

### Requirement: The result reports tree changes
The system SHALL fingerprint the working tree before the first reviewer starts and after the last one ends, report whether it changed, and list the changed paths when it did.

#### Scenario: Tree result
- **WHEN** a crosscheck ends
- **THEN** `working_tree` is `unchanged`, `changed`, or `unknown`

#### Scenario: A reviewer wrote a file
- **WHEN** a file in the working tree changed while the reviewers ran
- **THEN** `working_tree` is `changed` and the result lists that file's path

### Requirement: Finished crosschecks are recorded in the define they name
The system SHALL add each finished crosscheck whose call names a define to that define's state file, with the define's current step, the times, the working-tree result, and each reviewer's CLI, model, effort, and status.

#### Scenario: Recorded call
- **WHEN** a crosscheck that names a define ends
- **THEN** the define's state file lists it before the lead sees the final status

#### Scenario: No define named
- **WHEN** a crosscheck whose call names no define ends
- **THEN** no state file is written

### Requirement: A recording failure does not change the result
The system SHALL return the call's result even when recording it fails.

#### Scenario: Unwritable state
- **WHEN** the state file cannot be written
- **THEN** the lead still receives the call's result

### Requirement: Crosscheck logs are private
The system SHALL write logs under a per-user folder in the system temp folder, readable only by the user, and never inside the working tree.

#### Scenario: Log layout
- **WHEN** a crosscheck runs
- **THEN** each reviewer's prompt, acpx command, output, and answer are in a mode-700 folder for that repository and crosscheck, with mode-600 files

### Requirement: A reviewer is available when its CLI is installed
The system SHALL treat a `claude`, `codex`, or `agy` entry as available when its CLI is on `PATH`, and an entry for any other agent as available.

#### Scenario: agy not installed
- **WHEN** the config lists `agy` and `agy` is not on `PATH`
- **THEN** no agy reviewer runs and the other available reviewers do

#### Scenario: Another acpx agent
- **WHEN** an entry names an agent other than `claude`, `codex`, and `agy`
- **THEN** it counts as available, and if acpx cannot start it, that reviewer is `failed` with acpx's message

### Requirement: agy runs through its ACP server
The system SHALL start an `agy` entry as the acpx custom agent `agy acp`.

#### Scenario: agy entry
- **WHEN** an agy reviewer starts
- **THEN** acpx runs `agy acp` with the entry's model

### Requirement: Effort goes to each agent's own setting
The system SHALL apply an entry's effort through the agent's own setting where the plugin knows one, and SHALL NOT pass it otherwise.

#### Scenario: Claude
- **WHEN** a Claude reviewer starts
- **THEN** its effort is set through the Claude adapter's effort setting

#### Scenario: agy
- **WHEN** an agy reviewer starts
- **THEN** its effort is set as agy's thought level

#### Scenario: Codex
- **WHEN** a Codex reviewer starts
- **THEN** its effort is set as Codex's reasoning effort

#### Scenario: Another acpx agent
- **WHEN** a reviewer for another agent starts
- **THEN** no effort is passed and the result shows it as not applied

### Requirement: The crosscheck succeeds only when every reviewer answers
The system SHALL report a finished crosscheck as `succeeded` only when every reviewer succeeded, and as `failed` otherwise, with every reviewer's result.

#### Scenario: All answered
- **WHEN** every reviewer succeeded
- **THEN** the crosscheck is `succeeded`

#### Scenario: One failed
- **WHEN** one reviewer failed and another answered
- **THEN** the crosscheck is `failed`, and the result holds the failure and the other reviewer's answer

### Requirement: A crosscheck runs at any time
The system SHALL run `crosscheck` with or without a define in progress, at any step.

#### Scenario: Outside a define
- **WHEN** `crosscheck` is called with no define in progress
- **THEN** the reviewers run

#### Scenario: A step that is not a review step
- **WHEN** `crosscheck` is called during the specs step
- **THEN** the reviewers run

### Requirement: Naming a define that is not in progress is refused
The system SHALL refuse a `crosscheck` call whose `change_name` names no define in progress.

#### Scenario: A finished define
- **WHEN** `change_name` names a define that is complete or has no state file
- **THEN** the call is refused and no reviewer starts
