# Spec Delta

## Purpose

Defines how a define run is started, resumed, and moved through the ordered steps, and how each step's file is checked before the run advances.

## ADDED Requirements

### Requirement: Steps run in the workflow file's order
The system SHALL run the steps in the order given in `plugin/workflow.yaml`.

#### Scenario: The shipped steps
- **WHEN** the shipped workflow is loaded
- **THEN** the steps are proposal, specs, design, test-plan, and approach-review, in that order

#### Scenario: A step is returned once
- **WHEN** the agent completes each step in turn
- **THEN** each call returns the next step's prompt once

### Requirement: Step prompts have their placeholders filled
The system SHALL replace `{{change_name}}` and `{{reviews_dir}}` in each step prompt before returning it.

#### Scenario: Filled prompt
- **WHEN** a step is returned
- **THEN** the text holds the change name and the absolute path of the plugin's reviews folder

### Requirement: Each step ends with an instruction to call next_step
The system SHALL tell the agent, with every step it returns, to call `next_step` when the step is complete.

#### Scenario: A middle step
- **WHEN** a step other than the last is returned
- **THEN** its text tells the agent to call `next_step` with the change name as its final action

#### Scenario: The last step
- **WHEN** the returned step is the last one
- **THEN** its text says that the next `next_step` call validates the change and commits its documents

### Requirement: The workflow file is checked at startup
The system SHALL refuse to start, and say what is wrong, when `workflow.yaml` is missing, is not valid YAML, or breaks the workflow rules.

#### Scenario: A malformed workflow
- **WHEN** the file has no name, no description, no steps, a repeated step id, a step with no prompt, a tool other than `call_agent`, or a placeholder other than the two supported ones
- **THEN** the server exits with a message naming the file and the problem

### Requirement: Start creates the change folder
The system SHALL, when `next_step` is called with `start: true` and a new change name, run `openspec new change <name>`.

#### Scenario: A new define
- **WHEN** the agent starts a define with a name that has no change folder
- **THEN** the change folder exists

#### Scenario: OpenSpec fails
- **WHEN** `openspec new change` exits non-zero
- **THEN** the call is refused with the command's output

### Requirement: Start saves the first state and returns the first step
The system SHALL, after creating the change, save a state file that records the first step as current and return that step.

#### Scenario: A new define
- **WHEN** the change has just been created
- **THEN** the state file records the proposal step as current and the proposal step is returned

### Requirement: Change names use a fixed pattern
The system SHALL accept only change names made of lowercase letters, digits, and hyphens that start with a letter or digit.

#### Scenario: An invalid name
- **WHEN** the name contains an uppercase letter, a slash, a space, or a leading hyphen
- **THEN** the call is refused with the naming rule

### Requirement: An invalid name creates nothing
The system SHALL refuse an invalid change name before it creates any file or folder.

#### Scenario: Nothing is created
- **WHEN** an invalid name is refused
- **THEN** no change folder exists afterwards

### Requirement: Start refuses a folder define did not create
The system SHALL refuse to start over a change folder that has no state file.

#### Scenario: An existing folder
- **WHEN** `openspec/changes/<name>/` exists with no state file and the agent starts a define with that name
- **THEN** the call is refused and tells the user to choose another name

### Requirement: Completing refuses a folder define did not create
The system SHALL refuse to complete a step for a change that has no state file.

#### Scenario: Completing without a start
- **WHEN** `next_step` is called without `start` for a folder that has no state file
- **THEN** the call is refused and says no step is in progress for it

### Requirement: Resume returns the current step
The system SHALL, when `next_step` is called with `start: true` for a define in progress, return the current step without advancing.

#### Scenario: A new session picks up
- **WHEN** a second session, on either CLI, starts the same name after the first stopped at design
- **THEN** the design step is returned and no step is skipped or repeated

### Requirement: Resume lists the completed steps
The system SHALL list the completed steps, and where their files are, when it resumes a define.

#### Scenario: Completed steps
- **WHEN** a define stopped at design is resumed
- **THEN** the text lists proposal and specs as completed

### Requirement: Resume is recorded
The system SHALL add each resume, with the time, the lead CLI, and the step, to the state file.

#### Scenario: A resume entry
- **WHEN** a define is resumed
- **THEN** the state file's starts list gains an entry with mode `resume`

### Requirement: A finished define cannot be restarted
The system SHALL refuse `start` for a change that is already complete.

#### Scenario: A complete change
- **WHEN** the agent starts a define whose state is complete
- **THEN** the call is refused and gives the completion time

### Requirement: A finished define tells the agent to stop
The system SHALL tell the agent not to call `next_step` again when a complete define is completed again.

#### Scenario: Completing a complete change
- **WHEN** `next_step` is called without `start` for a complete define
- **THEN** the result says the workflow is finished and not to call again

### Requirement: Each step's file is checked before advancing
The system SHALL check the current step's file before it returns the next step.

#### Scenario: Files by step
- **WHEN** the agent completes proposal, specs, design, or test-plan
- **THEN** the system requires a non-empty `proposal.md`, at least one non-empty `specs/<capability>/spec.md`, a non-empty `design.md`, or a non-empty `test-plan.md`, respectively

#### Scenario: A step with no check
- **WHEN** the agent completes approach-review
- **THEN** no file check is made for that step alone

### Requirement: A failed file check refuses the call and names what is missing
The system SHALL refuse the call and name the missing file when the step's check fails.

#### Scenario: An empty file
- **WHEN** the step's file exists but is empty
- **THEN** the call is refused and names the missing file

#### Scenario: A failed check does not advance
- **WHEN** the call is refused
- **THEN** the current step in the state file is unchanged

### Requirement: OpenSpec must also report the artifact done
The system SHALL, for the proposal, specs, and design steps, also require `openspec status --change <name> --json` to report the matching artifact as `done`.

#### Scenario: OpenSpec disagrees
- **WHEN** the file is non-empty but OpenSpec reports the artifact in another status or does not report it
- **THEN** the call is refused and names the status OpenSpec gave

#### Scenario: OpenSpec fails
- **WHEN** `openspec status` exits non-zero or prints something that is not JSON
- **THEN** the call is refused with the command's output

### Requirement: Progress is saved in the change folder
The system SHALL record progress in `.define-openspec-change.json` inside the change folder.

#### Scenario: Recorded fields
- **WHEN** a step starts or completes
- **THEN** the file holds the workflow name, change name, status, current step, each step's start and completion times, each start or resume with its lead CLI, and the finished crosscheck calls

### Requirement: The state file is replaced in one step
The system SHALL write the state file by writing a temporary file and renaming it over the old one.

#### Scenario: No partial file
- **WHEN** the state is saved
- **THEN** the state file is either the old content or the new content

### Requirement: A state file is checked whole
The system SHALL refuse a state file that does not fit the workflow and the change.

#### Scenario: Wrong identity or steps
- **WHEN** the file has another workflow name or change name, an unknown step id, or a change folder other than the change's own
- **THEN** the file is unusable and the call is refused with the path

#### Scenario: Not JSON
- **WHEN** the file is not valid JSON
- **THEN** the call is refused with the path

### Requirement: An unusable state file is left as it was
The system SHALL NOT overwrite a state file it refused.

#### Scenario: A corrupt file
- **WHEN** the state file is refused
- **THEN** its bytes are the same afterwards

### Requirement: The change name can be left out when one define is in progress
The system SHALL use the only define in progress when `change_name` is omitted.

#### Scenario: One define
- **WHEN** exactly one define is in progress and the name is omitted
- **THEN** that define's step is completed

### Requirement: An omitted name is refused when it is ambiguous
The system SHALL refuse a call with no `change_name` when no define or more than one define is in progress.

#### Scenario: Two defines
- **WHEN** two changes are in progress and the name is omitted
- **THEN** the call is refused and lists both names

#### Scenario: Start needs a name
- **WHEN** `start` is true and the name is omitted
- **THEN** the call is refused and asks for a name

### Requirement: A git repository is required
The system SHALL refuse `next_step` when the session directory is not inside a git repository.

#### Scenario: Not a repository
- **WHEN** `next_step` is called outside a git repository
- **THEN** the call is refused and names the directory

### Requirement: next_step does not overlap a crosscheck
The system SHALL refuse `next_step` while a crosscheck call is starting or running.

#### Scenario: A running review
- **WHEN** a crosscheck is running and the agent calls `next_step`
- **THEN** the call is refused and names the call id, telling the agent to collect or cancel it first

### Requirement: next_step does not overlap another next_step
The system SHALL refuse `next_step` while another `next_step` is running.

#### Scenario: Overlapping calls
- **WHEN** a `next_step` call is still running and another arrives
- **THEN** the second is refused and told to wait
