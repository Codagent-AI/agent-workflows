# acceptance-rounds Specification

## Purpose
Defines how the `codagent-verify-change` workflow prepares an implemented change for human acceptance: it reviews assumptions, opens a draft pull request, and runs bounded rounds of independent testing, CI and fixes until the change converges or the rounds run out.

## Requirements

### Requirement: Worktree is clean before the pull request opens
The workflow SHALL fail to open the draft pull request while any tracked or untracked file has uncommitted changes.

#### Scenario: Untracked file remains
- **WHEN** an untracked file remains after the session report
- **THEN** the check lists it and one implementor repair runs, and a second failure fails the run

### Requirement: A round starts without the previous round's verdict
At the start of a round, the workflow SHALL clear the previous round's status and handoff.

#### Scenario: Later round
- **WHEN** a round follows round `n`
- **THEN** its index is `n + 1`, and `acceptance-round-status.txt` and `acceptance-handoff.md` are gone

### Requirement: A round keeps the earlier history
At the start of a round, the workflow SHALL keep the exploration log, the tested revision, the findings and any retest reason.

#### Scenario: History files remain
- **WHEN** a round starts after round 0
- **THEN** `exploration-log.md`, `acceptance-tested-revision.txt`, `acceptance-findings.md` and `acceptance-retest-reason.txt` are still there

### Requirement: Rounds are numbered from zero and the last is marked
The workflow SHALL number rounds from 0, and a round is the last when its index plus one reaches `acceptance_rounds`.

#### Scenario: First round
- **WHEN** the loop starts
- **THEN** the round index is 0, and the round is the last one only when `acceptance_rounds` is 1

#### Scenario: Last allowed round
- **WHEN** the round index plus one reaches `acceptance_rounds`
- **THEN** the round is marked last

### Requirement: A fresh tester explores the change each round
Each round SHALL start a fresh tester session that explores the change as a user would.

#### Scenario: First round covers every user-visible spec behavior
- **WHEN** the tester runs in round 0
- **THEN** it exercises every user-visible requirement or scenario the specs add or modify at least once, and then explores further by risk

#### Scenario: Later round tests the fix
- **WHEN** the tester runs in a later round
- **THEN** it reproduces each earlier finding and sizes its exploration from the diff against the revision in `acceptance-tested-revision.txt`

### Requirement: The tester does not change the repository
The tester SHALL NOT fix defects, change tracked files, commit or push.

#### Scenario: Tester finds a defect
- **WHEN** the tester finds a clear defect
- **THEN** it is recorded in `acceptance-findings.md` and no tracked file changes

### Requirement: Tester scratch files stay under the artifacts folder
The tester SHALL keep its temporary files, clones and server folders under `$ARTIFACTS_DIR/.archon/scratch/acceptance-test`.

#### Scenario: Tester leaves scratch files outside the worktree
- **WHEN** the tester needs temporary files or servers
- **THEN** they sit under `$ARTIFACTS_DIR/.archon/scratch/acceptance-test`, and the tester stops every server it started before it ends

### Requirement: The tester stops what it starts
The tester SHALL stop every server and long-running command it started before its step ends.

#### Scenario: Server left running
- **WHEN** the tester started a server
- **THEN** the tester stops it and confirms none is running before it ends

### Requirement: CI is awaited only when the tester reports ready
The workflow SHALL wait for CI only when the tester reports `ready: true`.

#### Scenario: Tester is not ready for CI
- **WHEN** the tester reports `ready: false` with a reason
- **THEN** the wait is skipped and the handoff records `not run` and the reason

#### Scenario: Tester is ready
- **WHEN** the tester reports `ready: true`
- **THEN** the workflow waits for CI, writes `ci/round-<n>.md`, and passes its status and path to the tester's handoff

### Requirement: The tester writes the handoff after the CI wait
The workflow SHALL have the same tester session write the handoff after the wait.

#### Scenario: Handoff resumes the tester
- **WHEN** the CI wait ended or was skipped
- **THEN** the tester session that explored the change resumes and receives the CI status, the report path and the reason

### Requirement: Convergence needs one revision, tested and ready
The gate SHALL report ready only when all of the following hold at the current `HEAD`: the round status ends with `READY <HEAD>`, the tested revision is `<HEAD>`, the exploration log and the handoff are not empty, and no tracked file has uncommitted changes.

#### Scenario: All conditions hold
- **WHEN** every condition holds
- **THEN** the gate reports `ready: true`, `fix: false` and no reasons

#### Scenario: Status names another revision
- **WHEN** the round status names a commit that is not `HEAD`
- **THEN** the gate reports not ready, with a reason naming both revisions

#### Scenario: Evidence is missing
- **WHEN** the exploration log or the handoff is missing or empty
- **THEN** the gate reports not ready and names the file

#### Scenario: Head cannot be read
- **WHEN** `git rev-parse` fails
- **THEN** the gate reports not ready because local `HEAD` could not be resolved

### Requirement: A fix is pushed and retested
The workflow SHALL push a fix so the next round retests it.

#### Scenario: Fix is retested
- **WHEN** a fix moved `HEAD`
- **THEN** the fix is pushed and another round starts

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

### Requirement: A push needs a committed, attached branch
The workflow SHALL fail a push when tracked changes are uncommitted or `HEAD` is detached.

#### Scenario: Tracked changes are uncommitted
- **WHEN** a tracked file has uncommitted changes after the fix
- **THEN** the push is not attempted and the check names the files

#### Scenario: Head is detached
- **WHEN** `HEAD` is detached
- **THEN** the push step fails asking for the change branch

### Requirement: The run declares whether acceptance converged
At the end, the workflow SHALL write `acceptance-preparation-status.txt` as `ACCEPTANCE_COMPLETE` or `ACCEPTANCE_FAILED`, read it back, and declare `ready` as the run's outcome.

#### Scenario: Converged
- **WHEN** the gate conditions hold at the end
- **THEN** the status is `ACCEPTANCE_COMPLETE` and `ready` is true

#### Scenario: Did not converge
- **WHEN** the conditions do not hold when the rounds end
- **THEN** the status is `ACCEPTANCE_FAILED`, `ready` is false, and the run still completes so the handoff reaches a human

### Requirement: A short handoff is written when acceptance did not converge
When acceptance did not converge, the workflow SHALL write a short `acceptance-handoff.md` naming the reasons, the head, the findings and the ledger.

#### Scenario: Short handoff content
- **WHEN** acceptance did not converge
- **THEN** the handoff names the rounds, the local head, each reason, and the paths of the findings and the assumptions ledger

### Requirement: The tester's own handoff is kept
When acceptance did not converge, the workflow SHALL keep the tester's own handoff.

#### Scenario: Tester handoff is kept
- **WHEN** the tester's handoff exists and does not begin with the generated heading
- **THEN** it is renamed `acceptance-handoff-tester.md` and the short handoff links to it

#### Scenario: Script is rerun
- **WHEN** the finishing step runs again after writing its own handoff
- **THEN** it does not move its own handoff over the tester's

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
