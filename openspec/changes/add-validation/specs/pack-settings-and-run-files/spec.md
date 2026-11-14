## ADDED Requirements

### Requirement: The implement workflow validates its inputs first
`codagent-implement-change` SHALL validate all its inputs before any other node and report every problem at once.

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

### Requirement: The review's fix loop completes when its rounds run out
The fix loop before the pull request SHALL complete, not fail, when its rounds are used.

#### Scenario: Fix rounds run out
- **WHEN** findings are still open after the last fix round
- **THEN** the loop completes, and the open `high` and `medium` findings go to `acceptance-assumptions.md`

## MODIFIED Requirements

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

#### Scenario: Invalid review strategy
- **WHEN** `review_strategy` is neither `builtin` nor `none`
- **THEN** the run is refused before any node runs

### Requirement: Agent nodes name a role with a tier fallback
Every agent node SHALL name a role alias with a tier fallback.

#### Scenario: Roles and tiers
- **WHEN** the workflows are read
- **THEN** the implementor and crosscheck use `large`, the tester and reviewer use `medium`, and no node names `@lead`

#### Scenario: Alias is unbound
- **WHEN** a role alias has no binding in the launch checkout's config
- **THEN** the node falls back to its tier

### Requirement: Agents and scripts share named files under the artifacts folder
Agents and scripts SHALL share the files `implementation-blocked.md`, `acceptance-assumptions.md`, `implementor-decisions.md`, `evidence/`, `planned-checklist.md`, `evidence-problems.txt`, `session-report.md`, the acceptance round files, `pr-title.txt`, `pr-body.md`, `pull-request.json`, `ci/round-<n>.md` and the review results under `review/` under the run's artifacts folder.

#### Scenario: Evidence problems are recorded
- **WHEN** the evidence check fails
- **THEN** `evidence-problems.txt` lists each problem, and a later passing check removes it

#### Scenario: Ruling is recorded
- **WHEN** an agent rules on a question a human might have decided
- **THEN** it appends a `## ` section to `acceptance-assumptions.md` with the question, requirement, ruling, rationale and pending decision

#### Scenario: Ordinary decision is recorded
- **WHEN** the implementor makes a decision that could change behavior, scope or integration
- **THEN** it records it in `implementor-decisions.md`

#### Scenario: Review result is recorded
- **WHEN** a review ends
- **THEN** its result is in `review/before-pr.md` or `review/acceptance.md`, for the place it ran

## REMOVED Requirements

### Requirement: Inputs are validated before any other node
**Reason**: Replaced by "The implement workflow validates its inputs first". `codagent-verify-change` is folded into the implement workflow, so its flags and their check are gone.
**Migration**: None.

### Requirement: Verification takes two flags defaulting to false
**Reason**: `codagent-verify-change` is folded into the implement workflow, which removes `skip_implementation_review` and `stop_unchanged_acceptance`.
**Migration**: A launch that passed either flag drops it. The workflow behaves as the implement run did with both set to `true`.

### Requirement: The implement workflow sets both flags
**Reason**: The flags are removed with `codagent-verify-change`.
**Migration**: None.
