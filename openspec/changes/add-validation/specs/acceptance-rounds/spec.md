## ADDED Requirements

### Requirement: An acceptance fix is reviewed before it is pushed
In each round with a fix that does not end the rounds, the workflow SHALL run the review after the implementor's fix and before the push.

#### Scenario: Fix is reviewed
- **WHEN** the implementor's fix in a round is done and the rounds go on
- **THEN** the review runs on what changed since the last reviewed revision, and the push follows it

#### Scenario: Unchanged fix ends the rounds
- **WHEN** a fix that changed nothing ends the rounds
- **THEN** no review runs for it

#### Scenario: Last round
- **WHEN** a round ends at the gate with no fix
- **THEN** no review runs in that round

### Requirement: The assumptions ledger exists before the pull request
The workflow SHALL fail unless `acceptance-assumptions.md` exists and is not empty.

#### Scenario: Ledger is missing
- **WHEN** the ledger is missing or empty
- **THEN** the handoff check names the file, one implementor repair runs, continuing the session report's session, and a second failure fails the run

#### Scenario: Ledger present
- **WHEN** an earlier step wrote the ledger
- **THEN** the handoff check passes

### Requirement: The implementor fixes a round that did not converge
When a round is not ready and not the last, the implementor SHALL fix the findings. The first round's fix SHALL continue the implementor's session from the pull request step, and each later round's fix SHALL continue the earlier fix's session.

#### Scenario: Implementor triages and commits
- **WHEN** the gate reports not ready on a non-last round
- **THEN** the implementor triages the findings and commits the fix

#### Scenario: Fix session carries across rounds
- **WHEN** a later round's fix runs
- **THEN** it continues the session of the earlier round's fix

#### Scenario: Last round ends at the gate
- **WHEN** the gate reports not ready on the last round
- **THEN** no fix runs and the rounds end

#### Scenario: Retest reason is cleared
- **WHEN** a fix is about to run
- **THEN** a stale `acceptance-retest-reason.txt` is removed first, so the implementor's new reason is the only one the next tester reads

### Requirement: A fix that changes nothing ends the rounds
The workflow SHALL end the rounds after a fix that left the tested revision as it was, left no tracked change, and wrote no retest reason.

#### Scenario: Fix made no progress
- **WHEN** the fix did none of those three things
- **THEN** nothing is pushed and the rounds end

#### Scenario: Retest reason keeps the rounds going
- **WHEN** the fix changed no file but wrote `acceptance-retest-reason.txt`
- **THEN** the fix counts as progress and the next round runs

#### Scenario: Worktree cannot be inspected
- **WHEN** git fails while the workflow decides progress
- **THEN** the step fails instead of counting the fix as progress

## MODIFIED Requirements

### Requirement: Worktree is clean before the pull request opens
The workflow SHALL fail to open the draft pull request while any tracked or untracked file has uncommitted changes.

#### Scenario: Untracked file remains
- **WHEN** an untracked file remains after the session report
- **THEN** the check lists it and one implementor repair runs, and a second failure fails the run

### Requirement: A fix is pushed without force
The workflow SHALL push the branch after a fix without force.

#### Scenario: Branch has an upstream
- **WHEN** the branch has a configured remote and merge ref
- **THEN** the push targets that ref

#### Scenario: Branch has no upstream
- **WHEN** no remote or merge ref is configured
- **THEN** the push sets the upstream on `origin`

#### Scenario: Push fails
- **WHEN** the push fails or tracked changes are uncommitted
- **THEN** one implementor repair runs in the fix session, and a second failure fails the run

## REMOVED Requirements

### Requirement: Assumptions are reviewed unless the caller did it
**Reason**: The assumption review and simplification ran only when `codagent-verify-change` was launched on its own, and that workflow is folded into `codagent-implement-change`.
**Migration**: None. An implement run never ran them; the implementor's own maintainability pass and the crosscheck audit cover that ground.

### Requirement: Assumptions ledger always exists before the pull request
**Reason**: Replaced by "The assumptions ledger exists before the pull request". The implementor repairs the ledger, and its scenario about a skipped review no longer applies.
**Migration**: None.

### Requirement: The lead fixes a round that did not converge
**Reason**: Replaced by "The implementor fixes a round that did not converge". The `@lead` role is removed.
**Migration**: A project's `@lead` binding goes unused; the fix runs on the `@implementor` binding.

### Requirement: A fix that changes nothing can end the rounds
**Reason**: Replaced by "A fix that changes nothing ends the rounds". The `stop_unchanged_acceptance` option is removed, and an unchanged fix always ends the rounds.
**Migration**: None. An implement run already set the option to `true`.
