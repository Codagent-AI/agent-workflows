## ADDED Requirements

### Requirement: The change is reviewed after the assumptions handoff check
After the assumptions handoff check passes, the workflow SHALL run the review before the clean-worktree check that precedes the pull request.

#### Scenario: Review follows the handoff check
- **WHEN** the assumptions handoff check passes
- **THEN** the review runs, and the clean-worktree check before the pull request follows it

#### Scenario: Review is off
- **WHEN** `review_strategy` is `none`
- **THEN** the clean-worktree check before the pull request follows the assumptions handoff check directly

### Requirement: Verification is part of the implement workflow
After the session report, the workflow SHALL itself run the assumptions-handoff check, the review, the clean-worktree check, the draft pull request and the acceptance rounds.

#### Scenario: Steps after the session report
- **WHEN** the session report is written
- **THEN** the same workflow runs the assumptions-handoff check, the review, the clean-worktree check, the draft pull request and the acceptance rounds, with no included verification workflow

### Requirement: The pull request continues the implementor's session
The assumptions-handoff repair, the clean-worktree repair before the pull request, and the draft pull request step SHALL continue the implementor's session from the session report.

#### Scenario: Pull request step
- **WHEN** the draft pull request step runs
- **THEN** it continues the session that wrote the session report

#### Scenario: Repair before the pull request
- **WHEN** the assumptions-handoff or clean-worktree check before the pull request fails
- **THEN** its repair continues the session that wrote the session report

## MODIFIED Requirements

### Requirement: An invalid definition fails the run after the allowed repairs
The workflow SHALL fail the run when the definition stays invalid after the allowed repairs. Each repair SHALL be the implementor's, in a fresh session.

#### Scenario: Repairs run out
- **WHEN** the definition is still invalid after three implementor repairs
- **THEN** the run fails

#### Scenario: Repair cannot proceed
- **WHEN** a repair agent reports it is blocked
- **THEN** the run fails with `REPAIR_BLOCKED: <reason>` before the definition is checked again

### Requirement: The run ends with the verification outcome
The workflow SHALL end with the outcome its acceptance status step declares.

#### Scenario: Acceptance converges
- **WHEN** the acceptance status reports `ready: true`
- **THEN** the implement run's authored outcome is succeeded

#### Scenario: Acceptance does not converge
- **WHEN** the acceptance status reports `ready: false`
- **THEN** the run still completes and its authored outcome is failed

## REMOVED Requirements

### Requirement: Verification runs with its review steps off
**Reason**: `codagent-verify-change` is folded into this workflow, and its assumption review and simplification are removed. An unchanged acceptance fix always ends the rounds.
**Migration**: None. The implement run behaves as it did with both flags set to `true`.
