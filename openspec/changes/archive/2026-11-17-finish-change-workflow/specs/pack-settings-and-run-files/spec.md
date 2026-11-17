## ADDED Requirements

### Requirement: Every other value comes from a pack setting
Every value other than `change_name` SHALL come from a pack setting with a default for an OpenSpec repository.

#### Scenario: Project overrides a setting
- **WHEN** `.archon/packs/codagent.yaml` under `settings:` sets `acceptance_rounds: 5`
- **THEN** the run uses it

#### Scenario: One run overrides a setting
- **WHEN** a launch passes `--input <setting>=<value>`
- **THEN** the value reaches the workflows the run includes, because the including workflow passes each setting on

#### Scenario: Invalid review strategy
- **WHEN** `review_strategy` is neither `builtin` nor `none`
- **THEN** the run is refused before any node runs

#### Scenario: Invalid stop point
- **WHEN** `stop_after` is neither `finish` nor `acceptance`
- **THEN** the run is refused before any node runs

### Requirement: A run can end after the acceptance rounds
With `stop_after: acceptance`, the workflow SHALL end after the acceptance rounds and the recheck of the rows still not verified, without committing the logs, archiving the change, finalizing the pull request or publishing the review package, and its outcome SHALL be succeeded exactly when acceptance converged. With the default, `finish`, every step SHALL run.

#### Scenario: Acceptance converges
- **WHEN** a launch sets `stop_after: acceptance` and acceptance converges
- **THEN** the run succeeds, with its pull request a draft and the change unarchived

#### Scenario: Acceptance does not converge
- **WHEN** a launch sets `stop_after: acceptance` and acceptance does not converge
- **THEN** the run's outcome is failed, and no review package is written

### Requirement: The change folder is fixed by the change name
The workflow SHALL use `openspec/changes/<change_name>` as the change's folder.

#### Scenario: Folder for a change
- **WHEN** the change is `add-greeting`
- **THEN** the folder is `openspec/changes/add-greeting`

### Requirement: Launch inputs are validated before any other node
`codagent-implement-change` SHALL validate all its inputs before any other node and report every problem at once.

#### Scenario: Bad change name
- **WHEN** `change_name` has uppercase letters, a leading hyphen, or characters other than lowercase letters, digits and hyphens
- **THEN** the run fails before any other node

#### Scenario: Rounds out of range
- **WHEN** `acceptance_rounds` is not a whole number from 1 to 10
- **THEN** the run fails, because the acceptance loop's ceiling is a literal 10

### Requirement: Agents get the OpenSpec validation sentence
The workflow SHALL tell agents to run `openspec validate --type change "<name>"` when an approved artifact changed.

#### Scenario: Sentence names the change
- **WHEN** an agent's prompt includes the validation sentence
- **THEN** it names the run's change

### Requirement: The checklist is committed on the change's branch
The checklist SHALL live at `openspec/changes/<name>/checklist.md` and be committed on the change's branch.

#### Scenario: Checklist is committed
- **WHEN** the checklist step passes
- **THEN** the commit holds only the checklist, with a message naming the change

### Requirement: A failed step after the acceptance rounds does not stop the run
When a check in the archive, in finalize, or on an acceptance round's push still fails after its repair, or its repair reports itself blocked, the workflow SHALL record the failure for the review package and go on. When an acceptance fix reports itself blocked, the rounds SHALL end as not converged, and the workflow SHALL record it and go on. Before the acceptance rounds end, any other check that still fails after its repairs SHALL still fail the run.

#### Scenario: Archive check fails after its repair
- **WHEN** the archive commit check still fails after its repair
- **THEN** the failure is recorded for the review package, and finalize runs

#### Scenario: Finalize repair is blocked
- **WHEN** a finalize repair reports itself blocked
- **THEN** finalize fails, the failure is recorded for the review package, and the package is written

#### Scenario: Acceptance push still fails
- **WHEN** an acceptance round's push still fails after its repair, or its repair reports itself blocked
- **THEN** the rounds end as not converged, the failure is recorded for the review package, and the logs, the archive, finalize and the package run

#### Scenario: Acceptance fix is blocked
- **WHEN** an acceptance fix fixes what it safely can, records a decision only the user can make, and reports itself blocked
- **THEN** the rounds end as not converged, the round's committed fixes are pushed in finalize, and the logs, the archive, finalize and the package run

#### Scenario: Check before the acceptance rounds
- **WHEN** the clean-worktree check before the pull request still fails after its repair
- **THEN** the run fails

### Requirement: Agents and scripts share named run files
Agents and scripts SHALL share these files under the run's artifacts folder: `implementation-blocked.md`, `implementation-complete.md`, `decision-log.md`, `dispute-log.md`, `evidence/`, `planned-checklist.md`, `evidence-problems.txt`, `session-report.md`, the acceptance round files, `pr-title.txt`, `pr-body.md`, `pull-request.json`, `ci/round-<n>.md` and the review results under `review/`, plus the files of the steps this change adds.

#### Scenario: Evidence problems are recorded
- **WHEN** the evidence check fails
- **THEN** `evidence-problems.txt` lists each problem, and a later passing check removes it

#### Scenario: Decision is recorded
- **WHEN** an agent settles on its own a question the definition did not settle that could change behavior, scope or integration
- **THEN** it appends a `## ` section to `decision-log.md` with the step, the question, the requirement, the decision, the alternatives, the rationale, what breaks if it is wrong and any decision pending from the user

#### Scenario: Dispute is recorded
- **WHEN** the implementor holds that an audit finding is not a violation, or a review cycle ends with a `high` or `medium` finding that is not closed
- **THEN** a `## ` section for it is appended to `dispute-log.md`

#### Scenario: Review result is recorded
- **WHEN** a review ends
- **THEN** its result is in `review/before-pr.md` or `review/acceptance.md`, for the place it ran

#### Scenario: Completion verdict is recorded
- **WHEN** the completion judge gives a verdict
- **THEN** the verdict and the judgment it closes are recorded in `completion-verdict.json` and `completion-loop.jsonl`, so a resumed run keeps a verdict already given

#### Scenario: Files of the added steps
- **WHEN** the workflows are read
- **THEN** the completion loop uses `completion-problems.txt`, `completion-check.json`, `completion-verdict.json`, `completion-loop.jsonl`, `continue-snapshot.json`, `implementation-remaining.md` and `implementor-response.md`; the archive uses `archive/state.json`; finalize writes `ci/finalize-<n>.md` and `ci/final.md`; and the review package uses `step-results.json`, `review-attention.json` and `review-package.md`

#### Scenario: Step results are recorded
- **WHEN** the archive or finalize ends, whether it succeeded or failed
- **THEN** `step-results.json` records the outcome, what failed and what is left to do, for the review package

## MODIFIED Requirements

### Requirement: A launch needs only the change name
A launch of `codagent-implement-change` SHALL need only `change_name`.

#### Scenario: Defaults suit an OpenSpec repository
- **WHEN** a launch gives only `change_name`
- **THEN** the change folder is `openspec/changes/<change_name>`, and the allowed rounds are 3

### Requirement: Agent nodes name a role with a tier fallback
Every agent node SHALL name a role alias with a tier fallback.

#### Scenario: Roles and tiers
- **WHEN** the workflows are read
- **THEN** the implementor and the audit use `large`, the tester, the completion judge and the code review use `medium`, and no node names `@lead` or `@crosscheck`

#### Scenario: Alias is unbound
- **WHEN** a role alias has no binding in the launch checkout's config
- **THEN** the node falls back to its tier

### Requirement: The review's fix loop completes when its rounds run out
The fix loop before the pull request SHALL complete, not fail, when its rounds are used.

#### Scenario: Fix rounds run out
- **WHEN** findings are still open after the last fix round
- **THEN** the loop completes, and the open `high` and `medium` findings go to the run's `dispute-log.md`

## REMOVED Requirements

### Requirement: Other values come from pack settings
**Reason**: The `change_kind`, `changes_root`, `change_label` and `artifact_validation_instruction` settings are removed, so the change kind's scenarios go. Replaced by "Every other value comes from a pack setting".
**Migration**: A project removes those settings from `.archon/packs/codagent.yaml`. Archon refuses a run whose settings file sets a key the pack does not declare.

### Requirement: The change folder is derived from the root and name
**Reason**: `changes_root` is removed. Replaced by "The change folder is fixed by the change name".
**Migration**: None. The default root was `openspec/changes`.

### Requirement: The implement workflow validates its inputs first
**Reason**: The checks of `changes_root` and `artifact_validation_instruction` go with the settings. Replaced by "Launch inputs are validated before any other node".
**Migration**: None.

### Requirement: Validation sentence is derived for OpenSpec
**Reason**: `artifact_validation_instruction` is removed, and every change is an OpenSpec change. Replaced by "Agents get the OpenSpec validation sentence".
**Migration**: A project that set its own sentence drops it.

### Requirement: The checklist is committed with the change
**Reason**: The change folder is always inside the repository, so the case for a folder outside it goes. Replaced by "The checklist is committed on the change's branch".
**Migration**: None.

### Requirement: Agents and scripts share named files under the artifacts folder
**Reason**: `acceptance-assumptions.md` and `implementor-decisions.md` are removed: agents record decisions in `decision-log.md` and disputes in `dispute-log.md`, and the run gains the completion loop's, the archive's, finalize's and the review package's files. Replaced by "Agents and scripts share named run files".
**Migration**: None. A run's earlier files are not read.
