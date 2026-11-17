# pack-settings-and-run-files Specification

## Purpose
Defines the pack's settings and inputs, how agent roles are named, how a failed check is repaired, and the files a run shares between its agents and scripts.

## Requirements

### Requirement: A launch needs only the change name
A launch of `codagent-implement-change` SHALL need only `change_name`.

#### Scenario: Defaults suit an OpenSpec repository
- **WHEN** a launch gives only `change_name`
- **THEN** the change folder is `openspec/changes/<change_name>`, and the allowed rounds are 3

### Requirement: Later nodes read the derived folder
Every node after input validation SHALL read the derived folder.

#### Scenario: Folder is read from validation
- **WHEN** a later node needs the change folder
- **THEN** it takes the value that input validation printed

### Requirement: Agent nodes name a role with a tier fallback
Every agent node SHALL name a role alias with a tier fallback.

#### Scenario: Roles and tiers
- **WHEN** the workflows are read
- **THEN** the implementor and the audit use `large`, the tester, the completion judge and the code review use `medium`, and no node names `@lead` or `@crosscheck`

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

### Requirement: The review's fix loop completes when its rounds run out
The fix loop before the pull request SHALL complete, not fail, when its rounds are used.

#### Scenario: Fix rounds run out
- **WHEN** findings are still open after the last fix round
- **THEN** the loop completes, and the open `high` and `medium` findings go to the run's `dispute-log.md`

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
