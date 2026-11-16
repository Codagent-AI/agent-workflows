## ADDED Requirements

### Requirement: Findings that were not fixed go to the logs
When a cycle's fix rounds stop, the workflow SHALL add to the run's `dispute-log.md` each `high` or `medium` finding that is not closed, with both sides of a contested or disputed finding, and to the run's `decision-log.md` each `high` or `medium` finding that closed because the reviewer accepted a decline or a reply, with the fixer's reason. A `low` finding that is not closed SHALL stay in the review result only. The run SHALL continue. Findings SHALL NOT fail the run.

#### Scenario: Findings remain before the pull request
- **WHEN** `high` or `medium` findings are not closed when the rounds before the pull request stop
- **THEN** each one is added to the dispute log with the result file, and the draft pull request opens

#### Scenario: Disputed finding
- **WHEN** a finding is disputed, or contested with no fix round left for the reply
- **THEN** its dispute-log entry holds the reviewer's finding and contest and the fixer's decline and any reply

#### Scenario: Finding is still open
- **WHEN** a `high` or `medium` finding is still open when the rounds stop, because the reviewer rejected its fix or no one acted on it
- **THEN** its dispute-log entry holds the reviewer's finding and the last fix attempt, if there was one

#### Scenario: Accepted decline
- **WHEN** the reviewer accepts a decline or a reply on a `high` or `medium` finding
- **THEN** the finding closes, and its decision-log entry holds the finding and the fixer's reason

#### Scenario: Low finding
- **WHEN** a `low` finding is not closed when the rounds stop
- **THEN** it is listed in the review result and added to neither log

#### Scenario: Findings remain in an acceptance round
- **WHEN** `high` or `medium` findings are not closed when a round's fix round ends
- **THEN** each one is added to the dispute log, and the round goes on to the push

#### Scenario: Nothing remains
- **WHEN** every `high` and `medium` finding of a cycle closed with a confirmed fix
- **THEN** nothing is added to either log

## MODIFIED Requirements

### Requirement: A later cycle does not reopen recorded findings
A review SHALL NOT check a finding that an earlier cycle added to the decision log or the dispute log.

#### Scenario: Recorded finding is handed off
- **WHEN** a finding was added to either log in an earlier cycle
- **THEN** no later review in the run checks it

### Requirement: The pull request's head is reviewed
The draft pull request SHALL open only after a review covered its exact head. When a step after the review commits before the pull request opens, the workflow SHALL review the new changes first.

#### Scenario: Repair commits after the review
- **WHEN** a repair commits after the review and before the pull request opens
- **THEN** those changes are reviewed before the pull request opens, with no fix rounds, and each new `high` or `medium` finding goes to the dispute log

#### Scenario: Head was reviewed
- **WHEN** the draft pull request opens
- **THEN** the latest review result before the pull request ends at the pull request's head

## REMOVED Requirements

### Requirement: Findings that were not fixed go to the assumptions record
**Reason**: `acceptance-assumptions.md` is removed. Replaced by "Findings that were not fixed go to the logs": accepted declines go to the decision log and findings that are not closed go to the dispute log, which the review package ranks.
**Migration**: None.
