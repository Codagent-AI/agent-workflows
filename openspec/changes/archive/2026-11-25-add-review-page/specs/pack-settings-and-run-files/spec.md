## MODIFIED Requirements

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

#### Scenario: Invalid review wait
- **WHEN** `review_wait` is neither `true` nor `false`
- **THEN** the run is refused before any node runs

### Requirement: A run can end after the acceptance rounds
With `stop_after: acceptance`, the workflow SHALL end after the acceptance rounds and the recheck of the rows still not verified, without committing the logs, archiving the change, finalizing the pull request, publishing the review package or waiting for the reviewer, and its outcome SHALL be succeeded exactly when acceptance converged. With the default, `finish`, every step SHALL run.

#### Scenario: Acceptance converges
- **WHEN** a launch sets `stop_after: acceptance` and acceptance converges
- **THEN** the run succeeds, with its pull request a draft and the change unarchived

#### Scenario: Acceptance does not converge
- **WHEN** a launch sets `stop_after: acceptance` and acceptance does not converge
- **THEN** the run's outcome is failed, and no review package is written

#### Scenario: Wait is on
- **WHEN** a launch sets `stop_after: acceptance` with `review_wait` true
- **THEN** the run writes no review page and does not wait

### Requirement: Agents and scripts share named run files
Agents and scripts SHALL share these files under the run's artifacts folder: `implementation-blocked.md`, `implementation-complete.md`, `decision-log.md`, `dispute-log.md`, `evidence/`, `planned-checklist.md`, `evidence-problems.txt`, `session-report.md`, the acceptance round files, `pr-title.txt`, `pr-body.md`, `pull-request.json`, `ci/round-<n>.md` and the review results under `review/`, plus the files of the steps this change adds.

#### Scenario: Evidence problems are recorded
- **WHEN** the evidence check fails
- **THEN** `evidence-problems.txt` lists each problem, and a later passing check removes it

#### Scenario: Decision is recorded
- **WHEN** an agent settles on its own a question the definition did not settle that could change behavior, scope or integration
- **THEN** it appends a `## ` section to `decision-log.md` with the step, the question, the requirement, the decision, the alternatives, the rationale and what breaks if it is wrong

#### Scenario: Dispute is recorded
- **WHEN** the implementor holds that an audit finding is not a violation, or a review cycle ends with a `high` or `medium` finding that is not closed
- **THEN** a `## ` section for it is appended to `dispute-log.md`

#### Scenario: Review result is recorded
- **WHEN** a review ends
- **THEN** its result is in `review/before-pr.md`, `review/acceptance.md` or `review/feedback.md`, for the place it ran

#### Scenario: Completion verdict is recorded
- **WHEN** the completion judge gives a verdict
- **THEN** the verdict and the judgment it closes are recorded in `completion-verdict.json` and `completion-loop.jsonl`, so a resumed run keeps a verdict already given

#### Scenario: Files of the added steps
- **WHEN** the workflows are read
- **THEN** the completion loop uses `completion-problems.txt`, `completion-check.json`, `completion-verdict.json`, `completion-loop.jsonl`, `continue-snapshot.json`, `implementation-remaining.md` and `implementor-response.md`; the archive uses `archive/state.json`; finalize writes `ci/finalize-<n>.md` and `ci/final.md`; and the review package uses `step-results.json`, `review-attention.json` and `review-package.md`

#### Scenario: Step results are recorded
- **WHEN** the archive or finalize ends, whether it succeeded or failed
- **THEN** `step-results.json` records the outcome, what failed and what is left to do, for the review package

## ADDED Requirements

### Requirement: The review wait is a setting
The `review_wait` setting SHALL default to `true`, which makes the run wait for the reviewer after publishing. With `false`, the run SHALL end after publishing, as it did before the wait existed.

#### Scenario: Default
- **WHEN** a launch does not set `review_wait`
- **THEN** the run waits for the reviewer after publishing

#### Scenario: Evaluation turns it off
- **WHEN** a launch passes `--input review_wait=false`
- **THEN** the run ends after publishing without waiting

### Requirement: Archon's address is a setting
The `archon_url` setting SHALL give Archon's address for the review page links in the pull request description, and SHALL be empty by default. When it is empty, the description SHALL name the run instead of linking.

#### Scenario: Address set
- **WHEN** `archon_url` is set
- **THEN** each page entry in the description links to that round's page under that address

#### Scenario: Address empty
- **WHEN** `archon_url` is empty
- **THEN** each page entry names its round and the run, with no link

### Requirement: The review rounds keep their files
The run SHALL keep in its artifacts folder `review-page-round-<n>.html` for each round's page, `review-page.html` as the latest page at its fixed address, `review-answers-round-<n>.json` for each answer the run accepted, and `acceptance-journeys/round-<k>.json` for the journeys each acceptance round exercised.

#### Scenario: Two rounds
- **WHEN** the reviewer sent feedback from round 1 and round 2's page is written
- **THEN** the folder holds `review-page-round-1.html`, `review-page-round-2.html`, `review-answers-round-1.json`, and `review-page.html` showing round 2

### Requirement: A failed step in a feedback round does not stop the run
When a step in a feedback round reports a failure, the workflow SHALL record it for the next page and go on to publish and wait. That covers the base merge, `address-feedback` reporting itself blocked, the push, the archive and finalize failing after their repairs, and a failed update of the pull request description. An agent that fails outright, from a provider error or output that never fits its schema, SHALL fail the run, and resuming the run continues the round.

#### Scenario: Finalize fails in a feedback round
- **WHEN** finalize still fails in a feedback round after its repairs
- **THEN** the next page shows the failure as a red item, and the run waits again

#### Scenario: Description update fails
- **WHEN** the pull request description cannot be updated in a feedback round
- **THEN** the round's page shows it as a red item, and the run waits

#### Scenario: Agent fails outright
- **WHEN** the reviewer in a feedback round ends without output that fits its schema
- **THEN** the run fails, naming the review
