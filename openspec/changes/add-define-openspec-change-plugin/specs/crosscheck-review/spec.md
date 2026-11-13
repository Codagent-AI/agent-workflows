# Spec Delta

## Purpose

Defines the independent review that a second agent runs on another CLI during a define: how it is configured, started, limited, waited on, and reported.

## ADDED Requirements

### Requirement: The crosscheck agent comes from the user's config
The system SHALL read the crosscheck agent from `human-workflows.crosscheck` in `~/.agent-workflows/config.yaml`.

#### Scenario: A valid list
- **WHEN** the list has an entry per CLI with `cli` set to `claude` or `codex` and optional `model` and `effort`
- **THEN** the entries are used, and an entry without `effort` gets `high`

#### Scenario: An invalid list
- **WHEN** the list is empty, repeats a CLI, names another CLI, or has a key other than `cli`, `model`, and `effort`
- **THEN** the config is reported as invalid with the problem

### Requirement: Other config keys are ignored
The system SHALL ignore every key in the config file except `human-workflows.crosscheck`.

#### Scenario: Other sections
- **WHEN** the file also holds `factory-workflows` or other keys under `human-workflows`
- **THEN** they do not change the result

### Requirement: The review runs on the other vendor's CLI
The system SHALL use the entry for the CLI that is not leading when it is listed and on `PATH`.

#### Scenario: Claude leads
- **WHEN** both CLIs are configured and installed and Claude leads
- **THEN** the review runs on Codex with that entry's model and effort

### Requirement: The review falls back to the lead's CLI
The system SHALL use the lead's own entry when the other CLI is not listed or not on `PATH`.

#### Scenario: Only the lead's CLI
- **WHEN** only the lead's CLI is configured or installed
- **THEN** the review runs on the lead's CLI in a separate session

### Requirement: An unknown lead uses the first usable entry
The system SHALL use the first listed CLI that is on `PATH` when the lead cannot be told.

#### Scenario: Unknown lead
- **WHEN** the client name is neither Claude nor Codex and the Claude environment marker is not set
- **THEN** the first listed CLI that is on `PATH` is used

### Requirement: Start refuses without a usable crosscheck
The system SHALL refuse `start` when the config is missing or invalid or no listed CLI is on `PATH`.

#### Scenario: Missing config
- **WHEN** a define is started and the config file does not exist
- **THEN** the call is refused and no change folder is created

### Requirement: call_agent refuses without a usable crosscheck
The system SHALL refuse `call_agent` when the config is missing or invalid or no listed CLI is on `PATH`.

#### Scenario: No usable config
- **WHEN** `call_agent` is called and no crosscheck can run
- **THEN** the call is refused with the code `crosscheck_not_configured`

### Requirement: Refusals point to the setup skill
The system SHALL name the `setup` skill in a refusal caused by the crosscheck config.

#### Scenario: Setup hint
- **WHEN** a call is refused for the config
- **THEN** the message names the setup skill

### Requirement: call_agent is limited to review steps
The system SHALL allow `call_agent` only for an in-progress define whose current step lists the tool in `workflow.yaml`, which are proposal and approach-review.

#### Scenario: Wrong step
- **WHEN** `call_agent` is called during specs
- **THEN** the call is refused and names the steps where it works

### Requirement: call_agent needs a change name when it is ambiguous
The system SHALL refuse `call_agent` with no `change_name` when more than one define is at a review step.

#### Scenario: Two defines
- **WHEN** two defines are at review steps and `change_name` is omitted
- **THEN** the call is refused as ambiguous and lists the names

### Requirement: Only the crosscheck target is accepted
The system SHALL accept only `agent: "crosscheck"`.

#### Scenario: Another target
- **WHEN** the agent names another target
- **THEN** the call is refused with a structured error

### Requirement: A prompt is required
The system SHALL refuse a call with an empty prompt.

#### Scenario: Empty prompt
- **WHEN** the prompt is empty or only spaces
- **THEN** the call is refused with a structured error

### Requirement: One call runs at a time
The system SHALL refuse `call_agent` while a call is running.

#### Scenario: A second call
- **WHEN** a call is running and `call_agent` is called again
- **THEN** the call is refused and names the running call id

### Requirement: Overlapping starts launch one child
The system SHALL launch one child when `call_agent` requests overlap.

#### Scenario: Two at once
- **WHEN** two `call_agent` requests arrive together
- **THEN** one child is started and the other request is refused

### Requirement: call_agent does not overlap next_step
The system SHALL refuse `call_agent` while `next_step` is running.

#### Scenario: Step in progress
- **WHEN** `next_step` is running and `call_agent` is called
- **THEN** the call is refused with the code `step_in_progress`

### Requirement: The child is read-only
The system SHALL start the child with only read-only access.

#### Scenario: Codex child
- **WHEN** the child is Codex
- **THEN** it runs `codex exec` in a read-only sandbox, ephemeral, with the configured effort and model

#### Scenario: Claude child
- **WHEN** the child is Claude
- **THEN** it runs `claude -p` with no settings sources, strict MCP config, no session persistence, and only the Read, Grep, Glob, and WebSearch tools

### Requirement: The child sees only the lead's prompt
The system SHALL give the child only the prompt the lead wrote, on its stdin.

#### Scenario: A long prompt
- **WHEN** the prompt is very long
- **THEN** it reaches the child on stdin and is not in the child's arguments

### Requirement: The child cannot reach the define tools
The system SHALL register no tools in a server that sees the child marker in its environment.

#### Scenario: Marked server
- **WHEN** the server starts with `DEFINE_OPENSPEC_CHANGE_CHILD` set
- **THEN** it answers the tool list with no tools

### Requirement: The child does not inherit the lead's session
The system SHALL set the child marker in the child's environment and remove the lead's Claude session variables.

#### Scenario: Child environment
- **WHEN** a child is started
- **THEN** it has `DEFINE_OPENSPEC_CHANGE_CHILD=1` and none of the lead's Claude session variables

### Requirement: Waiting returns before the host times out
The system SHALL wait up to 50 seconds by default in `call_agent` and `get_agent_call` before it returns.

#### Scenario: A slow child
- **WHEN** the child is still running after the wait
- **THEN** the result is `running` with a `call_id` and a note that it is not the answer, and `get_agent_call` later returns the result

### Requirement: The wait can be set
The system SHALL read the wait length from `DEFINE_OPENSPEC_CHANGE_WAIT_SECONDS` when it is a positive number.

#### Scenario: A set wait
- **WHEN** the variable is set to a positive number
- **THEN** the wait uses that many seconds

### Requirement: A call is stopped after 60 minutes
The system SHALL stop a call that runs 60 minutes.

#### Scenario: Over the limit
- **WHEN** the call passes its limit
- **THEN** the child is terminated

### Requirement: A timed-out call is reported as a timeout
The system SHALL report a call stopped for its limit as failed with the code `timeout`.

#### Scenario: Timeout status
- **WHEN** a call was stopped for its limit
- **THEN** its status is `failed` with code `timeout`

### Requirement: A call can be cancelled
The system SHALL stop a running child on `cancel_agent_call` and report the status as `canceled`.

#### Scenario: Cancel
- **WHEN** the agent cancels a running call
- **THEN** the child stops and later polls show `canceled`

### Requirement: A child that ignores termination is killed
The system SHALL end a cancelled or timed-out child with SIGKILL if it is still running after SIGTERM and a grace period.

#### Scenario: Ignored SIGTERM
- **WHEN** the child ignores SIGTERM
- **THEN** it is killed

### Requirement: Children do not outlive the server
The system SHALL stop every running child when the server exits.

#### Scenario: Server shutdown
- **WHEN** the server's stdin closes or it gets SIGTERM or SIGINT
- **THEN** running children are terminated, and killed if they remain

### Requirement: The call result reports the call
The system SHALL return the status, call id, CLI, model, effort, and elapsed time of a call.

#### Scenario: Call details
- **WHEN** a call is started or polled
- **THEN** the result holds those fields, with the model shown as `default` when none is set

### Requirement: A successful call returns the answer
The system SHALL return the child's answer, capped at 200,000 characters, when it exits cleanly with one.

#### Scenario: A finished call
- **WHEN** a child exits cleanly with an answer
- **THEN** the status is `succeeded` and the response holds the answer

### Requirement: A failed call returns its errors
The system SHALL report the status `failed`, with a code and the child's errors, when the child exits non-zero, gives no answer, or cannot start.

#### Scenario: A failed call
- **WHEN** the child exits non-zero with no answer
- **THEN** the status is `failed` with a code and the child's errors

### Requirement: The call result reports tree changes
The system SHALL report whether the working tree changed while the child ran.

#### Scenario: Tree result
- **WHEN** a call ends
- **THEN** `working_tree` is `unchanged`, `changed`, or `unknown`

### Requirement: The call result reports cost when known
The system SHALL report the cost of a Claude call when the child gives one.

#### Scenario: Cost
- **WHEN** a Claude child reports its cost
- **THEN** the result holds `cost_usd`

### Requirement: Finished calls are recorded
The system SHALL add each finished call to the change's state file with its step, CLI, model, effort, status, working-tree result, and times.

#### Scenario: Recorded call
- **WHEN** a call ends
- **THEN** the state file lists it before the lead sees the final status

### Requirement: A recording failure does not change the result
The system SHALL return the call's result even when recording it fails.

#### Scenario: Unwritable state
- **WHEN** the state file cannot be written
- **THEN** the lead still receives the call's result

### Requirement: Call logs are private
The system SHALL write logs under a per-user folder in the system temp folder, readable only by the user, and never inside the working tree.

#### Scenario: Log layout
- **WHEN** a call runs
- **THEN** its prompt, command, output, and final message are in a mode-700 folder for that repository and call, with mode-600 files, and tool calls are logged to `events.jsonl`
