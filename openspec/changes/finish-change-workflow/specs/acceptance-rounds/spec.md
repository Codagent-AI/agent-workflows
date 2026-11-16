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

## RENAMED Requirements

- FROM: `### Requirement: The run declares whether acceptance converged`
- TO: `### Requirement: The rounds record whether acceptance converged`

## REMOVED Requirements

### Requirement: The assumptions ledger exists before the pull request
**Reason**: `acceptance-assumptions.md` is removed, and its check and repair go with it. The decision log that takes its place can rightly be empty, and the session report reaches the review package through the tester's handoff.
**Migration**: None.
