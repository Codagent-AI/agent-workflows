## MODIFIED Requirements

### Requirement: A failed step after the acceptance rounds does not stop the run
When a check in the archive or in finalize still fails after its repair, or its repair reports itself blocked, the workflow SHALL record the failure for the review package and go on. When an acceptance fix reports itself blocked, the rounds SHALL end as not converged, and the workflow SHALL record it and go on. A push is not such a check: a push that still fails SHALL fail the run, as every push does. Before the acceptance rounds end, any other check that still fails after its repairs SHALL still fail the run.

#### Scenario: Archive check fails after its repair
- **WHEN** the archive commit check still fails after its repair
- **THEN** the failure is recorded for the review package, and finalize runs

#### Scenario: Finalize repair is blocked
- **WHEN** a finalize repair reports itself blocked
- **THEN** finalize fails, the failure is recorded for the review package, and the package is written

#### Scenario: Acceptance push still fails
- **WHEN** an acceptance round's push still fails after its repair, or its repair reports itself blocked
- **THEN** the rounds end as not converged, the push after the rounds tries again, and when it fails the run fails with no review package

#### Scenario: Acceptance fix is blocked
- **WHEN** an acceptance fix fixes what it safely can, records a decision only the user can make, and reports itself blocked
- **THEN** the rounds end as not converged, the round's committed fixes are pushed after the rounds, and the logs, the archive, finalize and the package run

#### Scenario: Check before the acceptance rounds
- **WHEN** the clean-worktree check before the pull request still fails after its repair
- **THEN** the run fails

### Requirement: A failed step in a feedback round does not stop the run
When a step in a feedback round reports a failure, the workflow SHALL record it for the next page and go on to publish and wait. That covers the base merge, `address-feedback` reporting itself blocked, the archive and finalize failing after their repairs, and a failed update of the pull request description. A push that still fails SHALL fail the run, as every push does. An agent that fails outright, from a provider error or output that never fits its schema, SHALL fail the run. Resuming a run that failed in a feedback round SHALL start the round again from the saved feedback.

#### Scenario: Finalize fails in a feedback round
- **WHEN** finalize still fails in a feedback round after its repairs
- **THEN** the next page shows the failure as a red item, and the run waits again

#### Scenario: Description update fails
- **WHEN** the pull request description cannot be updated in a feedback round
- **THEN** the round's page shows it as a red item, and the run waits

#### Scenario: Push fails in a feedback round
- **WHEN** the round's push still fails after its repair
- **THEN** the run fails, and no page is written for the round

#### Scenario: Agent fails outright
- **WHEN** the reviewer in a feedback round ends without output that fits its schema
- **THEN** the run fails, naming the review
