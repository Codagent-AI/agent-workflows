# pack-settings-and-run-files Specification

## Purpose
Defines the pack's settings and inputs, how agent roles are named, how a failed check is repaired, and the files a run shares between its agents and scripts.

## Requirements

### Requirement: A launch needs only the change name
A launch of `codagent-implement-change` SHALL need only `change_name`.

#### Scenario: Defaults suit an OpenSpec repository
- **WHEN** a launch gives only `change_name`
- **THEN** the change kind is `openspec`, the changes root is `openspec/changes`, the label is `OpenSpec change`, and the allowed rounds are 3

### Requirement: Other values come from pack settings
Every other value SHALL come from a pack setting with a default for an OpenSpec repository.

#### Scenario: Project overrides the settings
- **WHEN** `.archon/packs/codagent.yaml` under `settings:` sets `change_kind: spec-driven` and a `changes_root`
- **THEN** the run uses them

#### Scenario: One run overrides a setting
- **WHEN** a launch passes `--input <setting>=<value>`
- **THEN** the value reaches the workflows the run includes, because the including workflow passes each setting on

#### Scenario: Invalid change kind
- **WHEN** `change_kind` is neither `openspec` nor `spec-driven`
- **THEN** the run is refused before any node runs

### Requirement: The change folder is derived from the root and name
The workflow SHALL compute the change's folder as `<changes_root>/<change_name>`.

#### Scenario: Default folder
- **WHEN** the changes root is `openspec/changes` and the change is `add-greeting`
- **THEN** the folder is `openspec/changes/add-greeting`

#### Scenario: Trailing slash
- **WHEN** the changes root ends in slashes
- **THEN** the folder has a single slash before the name

### Requirement: Later nodes read the derived folder
Every node after input validation SHALL read the derived folder.

#### Scenario: Folder is read from validation
- **WHEN** a later node needs the change folder
- **THEN** it takes the value that input validation printed

### Requirement: Inputs are validated before any other node
Both workflows SHALL validate all their inputs first and report every problem at once.

#### Scenario: Bad change name
- **WHEN** `change_name` has uppercase letters, a leading hyphen, or characters other than lowercase letters, digits and hyphens
- **THEN** the run fails before any other node

#### Scenario: Rounds out of range
- **WHEN** `acceptance_rounds` is not a whole number from 1 to 10
- **THEN** the run fails, because the acceptance loop's ceiling is a literal 10

#### Scenario: OpenSpec change with another root
- **WHEN** the kind is `openspec` and `changes_root` is not `openspec/changes`
- **THEN** the run fails

#### Scenario: Spec-driven change without a validation sentence
- **WHEN** the kind is `spec-driven` and `artifact_validation_instruction` is empty
- **THEN** the run fails saying it must not be empty

#### Scenario: Flags are not booleans
- **WHEN** `codagent-verify-change` is given a `skip_implementation_review` or `stop_unchanged_acceptance` that is not `true` or `false`
- **THEN** the run fails naming the input

### Requirement: Validation sentence is derived for OpenSpec
When the kind is `openspec` and the setting is empty, the workflow SHALL tell agents to run `openspec validate --type change "<name>"` when an approved artifact changed.

#### Scenario: Setting wins
- **WHEN** the setting is not empty
- **THEN** agents get the setting's sentence

#### Scenario: Empty setting, OpenSpec kind
- **WHEN** the setting is empty and the kind is `openspec`
- **THEN** agents get the sentence naming the change

### Requirement: Verification takes two flags defaulting to false
`codagent-verify-change` SHALL take `skip_implementation_review` and `stop_unchanged_acceptance` as inputs defaulting to `false`.

#### Scenario: Verification run on its own
- **WHEN** `codagent-verify-change` is launched with only `change_name`
- **THEN** it reviews assumptions, simplifies, and does not stop on an unchanged fix

### Requirement: The implement workflow sets both flags
`codagent-implement-change` SHALL set both flags to `true` when it includes verification.

#### Scenario: Flags are set by the caller
- **WHEN** the implement workflow includes verification
- **THEN** both flags are `true`

### Requirement: Agent nodes name a role with a tier fallback
Every agent node SHALL name a role alias with a tier fallback.

#### Scenario: Roles and tiers
- **WHEN** the workflows are read
- **THEN** the implementor, crosscheck and lead use `large`, and the tester uses `medium`

#### Scenario: Alias is unbound
- **WHEN** a role alias has no binding in the launch checkout's config
- **THEN** the node falls back to its tier

### Requirement: Agent nodes name no provider, model or effort
No agent node SHALL name a provider, model or effort.

#### Scenario: Binding decides
- **WHEN** a node runs
- **THEN** the launch checkout's alias binding decides provider, model and effort

### Requirement: Every agent node sets its context
Every agent node SHALL set `context` to `fresh` or to a resume of a named node.

#### Scenario: Repair resumes its role
- **WHEN** a repair for the implementor's step runs
- **THEN** it resumes that step's session instead of starting a new one

### Requirement: A check reports its result on the first run
A check script SHALL report `{ok, problems}` on its first run.

#### Scenario: Check passes
- **WHEN** the first run reports `ok: true`
- **THEN** the repair and recheck nodes are skipped

### Requirement: A failed check gets one repair and a strict recheck
A failure SHALL go to one repair agent and then to the same check in strict mode.

#### Scenario: Repair fixes the problem
- **WHEN** the repair runs and the strict recheck passes
- **THEN** the run continues

#### Scenario: Problem remains
- **WHEN** the strict recheck still fails
- **THEN** the node fails with the problem text

### Requirement: A blocked repair fails the recheck
A repair that reports itself blocked SHALL fail the recheck with its reason.

#### Scenario: Repair is blocked
- **WHEN** the repair returns `blocked: true` with a reason
- **THEN** the recheck fails at once with `REPAIR_BLOCKED: <reason>`, and with no reason it says the agent gave none

### Requirement: A repair loop ends when its recheck passes
A repair loop SHALL end as soon as its recheck passes.

#### Scenario: Recheck passes
- **WHEN** the recheck passes during a loop
- **THEN** no further repair runs

### Requirement: A repair loop fails the run when its repairs run out
A repair loop SHALL fail the run when its allowed repairs are used.

#### Scenario: Evidence loop
- **WHEN** the evidence is still incomplete after two repairs
- **THEN** the run fails

### Requirement: The acceptance loop completes when its rounds run out
The acceptance loop SHALL complete, not fail, when its rounds are used.

#### Scenario: Acceptance loop
- **WHEN** the acceptance rounds are used without convergence
- **THEN** the loop completes instead of failing, so the final status step records the outcome

### Requirement: Agents and scripts share named files under the artifacts folder
Agents and scripts SHALL share the files `implementation-blocked.md`, `acceptance-assumptions.md`, `implementor-decisions.md`, `evidence/`, `planned-checklist.md`, `evidence-problems.txt`, `session-report.md`, the acceptance round files, `pr-title.txt`, `pr-body.md`, `pull-request.json` and `ci/round-<n>.md` under the run's artifacts folder.

#### Scenario: Evidence problems are recorded
- **WHEN** the evidence check fails
- **THEN** `evidence-problems.txt` lists each problem, and a later passing check removes it

#### Scenario: Ruling is recorded
- **WHEN** an agent rules on a question a human might have decided
- **THEN** it appends a `## ` section to `acceptance-assumptions.md` with the question, requirement, ruling, rationale and pending decision

#### Scenario: Ordinary decision is recorded
- **WHEN** the implementor makes a decision that could change behavior, scope or integration
- **THEN** it records it in `implementor-decisions.md`

### Requirement: The checklist is committed with the change
The checklist SHALL live at `<change_dir>/checklist.md` and be committed on the change's branch.

#### Scenario: Checklist is committed
- **WHEN** the checklist step passes
- **THEN** the commit holds only the checklist, with a message naming the change

#### Scenario: Change folder is outside the repository
- **WHEN** the change folder is not inside the repository
- **THEN** the checklist stays uncommitted and the checks do not require a commit
