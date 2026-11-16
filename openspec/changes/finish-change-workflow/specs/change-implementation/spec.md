## ADDED Requirements

### Requirement: The implement turn ends with a record
The implementor SHALL end each implement turn and each continue pass by writing either a completion record, which says what is complete and where its evidence is, or a blocked record, which says why only a person can unblock the work and the decision needed.

#### Scenario: Implementor finishes
- **WHEN** the implementor believes the change is done
- **THEN** it writes the completion record, and the completion check runs

#### Scenario: Implementor is blocked
- **WHEN** only a person can unblock the work
- **THEN** the implementor writes the blocked record, and the run stops

### Requirement: A completion check decides whether the implementation is done
After each implement turn, continue pass and record fix, a script SHALL check that the checklist passes the evidence check, that the completion record exists and is not empty, that the implementation made a commit of its own since it started, and that every checklist row is `verified`.

#### Scenario: Implementation is complete
- **WHEN** all four checks pass
- **THEN** the completion loop ends, no judge runs, and the audit starts

#### Scenario: Implementation is not complete
- **WHEN** any of the four checks fails
- **THEN** the check lists each problem, and the judge decides why

#### Scenario: Judge commits do not count
- **WHEN** the only commits since the implementation started are the judge's record fixes
- **THEN** the check reports that the implementation made no commit

### Requirement: A judge decides why the implementation is not complete
When the completion check fails, an inspection-only judge on `@tester`, in a fresh session, SHALL give one verdict: `blocked`, `continue`, `fix-record` or `complete`. It SHALL read the check's problems, the checklist, the saved evidence, the git history since the implementation started and the implementor's last response, and lean toward `continue` when unsure.

#### Scenario: Only a person can unblock the work
- **WHEN** the judge's verdict is `blocked`
- **THEN** the judge has written the blocked record, and the run stops

#### Scenario: Work remains
- **WHEN** the judge's verdict is `continue` with a list of remaining work
- **THEN** the implementor continues in its own session with that list and ends the pass with a record

#### Scenario: Record is incomplete
- **WHEN** the judge's verdict is `fix-record`
- **THEN** the judge has changed only the checklist's Code, Evidence and Status cells or written the completion record, has committed only the checklist, and the completion check runs again

#### Scenario: Only reasoned gaps remain
- **WHEN** the judge's verdict is `complete`, and the completion check found that every other part passed and every row that is not `verified` is `not verified` with a reason
- **THEN** the completion loop ends and the audit starts

### Requirement: The completion loop is bounded
The workflow SHALL allow at most three continue passes and at most two `fix-record` verdicts in a row, and SHALL fail the run when the judge gives an invalid verdict or a continue pass makes no progress.

#### Scenario: Continue passes run out
- **WHEN** the judge gives a fourth `continue` verdict
- **THEN** the run fails and lists the work that remains

#### Scenario: Record cannot be fixed
- **WHEN** the judge gives a third `fix-record` verdict in a row
- **THEN** the run fails saying the record could not be fixed

#### Scenario: Continue pass makes no progress
- **WHEN** a continue pass adds no commit and changes no checklist row
- **THEN** the run fails saying the implementation stalled

#### Scenario: Verdict is invalid
- **WHEN** the verdict is missing, malformed or unknown, a `continue` verdict lists no remaining work, a `blocked` verdict has no blocked record, or a `complete` verdict lacks the completion check's agreement
- **THEN** the run fails saying the judge returned no valid verdict

### Requirement: The OpenSpec definition is validated before the implementor starts
The workflow SHALL validate the approved OpenSpec change definition before the implementor starts.

#### Scenario: Valid definition passes without a repair
- **WHEN** the definition has a non-empty proposal, design, test plan and at least one non-empty spec
- **THEN** the definition check passes and no repair agent runs

#### Scenario: OpenSpec change is also validated by the OpenSpec CLI
- **WHEN** `openspec validate --type change <name>` fails
- **THEN** the definition check fails and the CLI's output is reported as the problem

### Requirement: The workflow commits the change's definition
The workflow SHALL commit the change's definition in `openspec/changes/<name>`.

#### Scenario: OpenSpec definition is committed
- **WHEN** the change folder has uncommitted files
- **THEN** the workflow commits that folder, plus a new `openspec/config.yaml` if there is one, with a message naming the change

#### Scenario: Definition is already committed
- **WHEN** the change folder has no staged, unstaged or untracked files and is in `HEAD`
- **THEN** the workflow commits nothing and the step passes

### Requirement: The worktree is clean before implementation
The workflow SHALL require that no tracked file has uncommitted changes before implementation starts.

#### Scenario: Worktree is clean
- **WHEN** no tracked file has uncommitted changes after the definition is committed
- **THEN** the check passes and the checklist step starts

#### Scenario: Tracked file is dirty
- **WHEN** a tracked file has uncommitted changes when implementation is about to start
- **THEN** the run fails telling the operator to commit or remove them

### Requirement: The change is reviewed after the session report
After the session report, the workflow SHALL run the review before the clean-worktree check that precedes the pull request.

#### Scenario: Review follows the session report
- **WHEN** the session report is written
- **THEN** the review runs, and the clean-worktree check before the pull request follows it

#### Scenario: Review is off
- **WHEN** `review_strategy` is `none`
- **THEN** the clean-worktree check before the pull request follows the session report directly

## MODIFIED Requirements

### Requirement: Verification is part of the implement workflow
After the session report, the workflow SHALL itself run the review, the clean-worktree check, the draft pull request, the acceptance rounds, the logs, the archive, finalize and the review package.

#### Scenario: Steps after the session report
- **WHEN** the session report is written
- **THEN** the same workflow runs the review, the clean-worktree check, the draft pull request, the acceptance rounds, the logs, the archive, finalize and the review package, with no included verification workflow

### Requirement: The repair before the pull request continues the implementor's session
The clean-worktree repair before the pull request SHALL continue the implementor's session from the session report. The draft pull request step SHALL start a fresh session.

#### Scenario: Pull request step
- **WHEN** the draft pull request step runs
- **THEN** it starts a fresh session, and writes the pull request from the change folder and the branch's commits

#### Scenario: Repair before the pull request
- **WHEN** the clean-worktree check before the pull request fails
- **THEN** its repair continues the session that wrote the session report

### Requirement: Implementor writes a session report
The workflow SHALL have the implementor write its session report to `session-report.md` in the artifacts folder.

#### Scenario: Report lists unverified rows and decisions
- **WHEN** the session report step runs
- **THEN** its prompt requires every row that is not verified and every decision in the run's `decision-log.md`, and the report is written to the fixed file

### Requirement: Evidence repairs are limited to two
After the audit's findings are resolved, the workflow SHALL allow up to two evidence repairs.

#### Scenario: Repair completes the evidence
- **WHEN** the first evidence repair after the audit completes the checklist
- **THEN** the repairs end and the clean-worktree check runs

#### Scenario: Evidence repairs run out
- **WHEN** the evidence is still incomplete after two repairs
- **THEN** the run fails

### Requirement: A separate reviewer audits by inspection
The workflow SHALL have the reviewer, on `@reviewer`, audit the implementation against the definition and the checklist without running anything.

#### Scenario: Audit runs nothing
- **WHEN** the reviewer audits
- **THEN** it reads the code, the checklist and the evidence, and runs no test, build or product command

### Requirement: Audit findings go to the implementor
The workflow SHALL pass the audit's findings to the implementor.

#### Scenario: Audit has findings
- **WHEN** the audit lists findings
- **THEN** the implementor resolves them in its own session and the text of the findings reaches that step

#### Scenario: Audit has no findings
- **WHEN** the audit answers `No findings.`
- **THEN** the implementor changes nothing

#### Scenario: Implementor disputes an audit finding
- **WHEN** the implementor holds that an audit finding is not a violation
- **THEN** it does not fix it, and records the finding as the auditor gave it, the requirement and its reason in the run's `dispute-log.md`

### Requirement: A recorded block stops the run
When an implementor step or the completion judge writes `implementation-blocked.md`, the workflow SHALL fail the next check with the recorded question.

#### Scenario: Implementor records a block
- **WHEN** `implementation-blocked.md` exists after the checklist step, an implement turn, a continue pass, the judge or the resolve-findings step
- **THEN** the check fails, prints the file, and says to update the definition and start a new run

## REMOVED Requirements

### Requirement: The change is reviewed after the assumptions handoff check
**Reason**: The assumptions handoff check and its repair are removed with `acceptance-assumptions.md`. Replaced by "The change is reviewed after the session report".
**Migration**: None.

### Requirement: Definition is validated before the implementor starts
**Reason**: The spec-driven change kind is removed, so the spec-driven requirement check goes. Replaced by "The OpenSpec definition is validated before the implementor starts".
**Migration**: None. Every change is an OpenSpec change, validated with the OpenSpec CLI as before.

### Requirement: An OpenSpec definition is committed by the workflow
**Reason**: Every change is an OpenSpec change in `openspec/changes/<name>`, and the name is validated at launch, so the change kind condition and the check for a change folder outside the repository go. Replaced by "The workflow commits the change's definition".
**Migration**: None.

### Requirement: No tracked change remains before implementation
**Reason**: The spec-driven case, where the workflow did not commit the definition, is removed. Replaced by "The worktree is clean before implementation".
**Migration**: None.

### Requirement: The run ends with the verification outcome
**Reason**: The run's outcome now also depends on the archive, finalize and the review package. The `pull-request-finalization` capability defines it.
**Migration**: None. A run whose acceptance converges and whose later steps succeed still ends succeeded.

## RENAMED Requirements

- FROM: `### Requirement: A separate crosscheck audits by inspection`
- TO: `### Requirement: A separate reviewer audits by inspection`
- FROM: `### Requirement: The pull request continues the implementor's session`
- TO: `### Requirement: The repair before the pull request continues the implementor's session`
