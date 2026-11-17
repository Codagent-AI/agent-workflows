## ADDED Requirements

### Requirement: Rows still not verified are rechecked after the rounds
After the acceptance rounds end, before the run stops after acceptance or commits the logs, the workflow SHALL list the checklist rows still marked not verified. When there are any, the implementor SHALL rerun the checks those rows name, integration and end-to-end tests included, with a 10-minute limit per command, mark each row verified, failed or not verified with its reason, and commit only the checklist.

#### Scenario: Rows are still not verified
- **WHEN** checklist rows are marked not verified when the rounds end
- **THEN** the implementor reruns their checks, saves the output as evidence and commits the updated checklist

#### Scenario: Every row is settled
- **WHEN** no checklist row is marked not verified when the rounds end
- **THEN** no recheck runs

#### Scenario: A rerun check fails
- **WHEN** a rerun check fails
- **THEN** its row is marked failed, no other file changes, and the row becomes a red item

#### Scenario: Run stops after acceptance
- **WHEN** `stop_after` is `acceptance` and the recheck committed the checklist
- **THEN** the workflow pushes the branch, and a push that fails is recorded as an acceptance failure, so the run's outcome is failed

## MODIFIED Requirements

### Requirement: The rounds record whether acceptance converged
When the rounds end, the workflow SHALL write `acceptance-preparation-status.txt` as `ACCEPTANCE_COMPLETE` or `ACCEPTANCE_FAILED`, read it back as `ready`, and go on to the archive whether or not acceptance converged.

#### Scenario: Converged
- **WHEN** the gate conditions hold at the end
- **THEN** the status is `ACCEPTANCE_COMPLETE`, `ready` is true, and the archive runs

#### Scenario: Did not converge
- **WHEN** the conditions do not hold when the rounds end
- **THEN** the status is `ACCEPTANCE_FAILED`, `ready` is false, the archive and finalize still run, and the review package lists the failed acceptance as a red item

### Requirement: A short handoff is written when acceptance did not converge
When acceptance did not converge, the workflow SHALL write a short `acceptance-handoff.md` naming the reasons, the head, the findings and the decision log.

#### Scenario: Short handoff content
- **WHEN** acceptance did not converge
- **THEN** the handoff names the rounds, the local head, each reason, and the paths of the findings and the run's `decision-log.md`

### Requirement: The tester writes the handoff after the CI wait
The workflow SHALL have the same tester session write the handoff after the wait. When the round is not ready and is not the last, the handoff SHALL hold only the head, why the round is not ready, and the paths of the findings and the exploration log, because a fix and another round follow and only the last round's handoff reaches the person.

#### Scenario: Handoff resumes the tester
- **WHEN** the CI wait ended or was skipped
- **THEN** the tester session that explored the change resumes and receives the CI status, the report path, the reason and whether the round is the last

#### Scenario: Round before the last is not ready
- **WHEN** the tester finds the round not ready and another round may follow
- **THEN** it writes the short handoff and the round status

#### Scenario: Ready or last round
- **WHEN** the round is ready, or it is the last round
- **THEN** the tester writes the full handoff

## RENAMED Requirements

- FROM: `### Requirement: The run declares whether acceptance converged`
- TO: `### Requirement: The rounds record whether acceptance converged`

## REMOVED Requirements

### Requirement: The assumptions ledger exists before the pull request
**Reason**: `acceptance-assumptions.md` is removed, and its check and repair go with it. The decision log that takes its place can rightly be empty, and the session report reaches the review package through the tester's handoff.
**Migration**: None.
