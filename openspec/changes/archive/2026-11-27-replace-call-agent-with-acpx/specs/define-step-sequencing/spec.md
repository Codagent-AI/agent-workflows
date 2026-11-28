## MODIFIED Requirements

### Requirement: Step prompts have their placeholders filled
The system SHALL replace `{{change_name}}` with the change name and each `{{review:<file>}}` with the text of that file in the plugin's `reviews/` folder, in each step prompt before returning it.

#### Scenario: Filled prompt
- **WHEN** a step is returned
- **THEN** the text holds the change name, and the full text of each review file its prompt names

### Requirement: Shared step text is written once and added to each step
The system SHALL add the workflow file's `every_step` text after each step's own prompt, and SHALL add no other shared text. A step's own prompt says whether and when to run `crosscheck`.

#### Scenario: A review step
- **WHEN** the proposal or approach-review step is returned
- **THEN** its text holds the step's own prompt and the `every_step` text, in that order, each once, before the instruction to call `next_step`

#### Scenario: Any other step
- **WHEN** the specs, design, or test-plan step is returned
- **THEN** its text holds the step's own prompt and the `every_step` text, in that order, each once, before the instruction to call `next_step`

### Requirement: The workflow file is checked at startup
The system SHALL refuse to start, and say what is wrong, when `workflow.yaml` is missing, is not valid YAML, or breaks the workflow rules.

#### Scenario: A malformed workflow
- **WHEN** the file has no name, no description, no steps, a repeated step id, a step with no prompt, a key under `shared_prompts` other than `every_step`, a placeholder other than `{{change_name}}` and `{{review:<file>}}`, or a `{{review:<file>}}` whose file is not in the plugin's `reviews/` folder
- **THEN** the server exits with a message naming the file and the problem

### Requirement: Progress is saved in the change folder
The system SHALL record progress in `.define-openspec-change.json` inside the change folder.

#### Scenario: Recorded fields
- **WHEN** a step starts or completes
- **THEN** the file holds the workflow name, change name, status, current step, each step's start and completion times, each start or resume with its lead CLI, and the finished crosschecks, each with each reviewer's result

### Requirement: next_step does not overlap a crosscheck
The system SHALL refuse `next_step` while a crosscheck is starting or running.

#### Scenario: A running review
- **WHEN** a crosscheck is running and the agent calls `next_step`
- **THEN** the call is refused and names the crosscheck id, telling the agent to collect it with `get_crosscheck` or stop it with `cancel_crosscheck` first

## ADDED Requirements

### Requirement: An older state file still loads
The system SHALL load a state file that records crosscheck calls in the form used before this change, and SHALL keep those entries as they were.

#### Scenario: A define started before the change
- **WHEN** a define in progress has a state file with crosscheck calls recorded before this change
- **THEN** the file loads, the define continues from its current step, and the old entries are unchanged
