# change-implementation Specification

## Purpose
Defines how the `codagent-implement-change` workflow takes an approved change definition through a checklist, an implementation, an audit and a clean, committed worktree, before it hands the change to verification.

## Requirements

### Requirement: Definition is validated before the implementor starts
The workflow SHALL validate the approved change definition before the implementor starts.

#### Scenario: Valid definition passes without a repair
- **WHEN** the definition has a non-empty proposal, design, test plan and at least one non-empty spec
- **THEN** the definition check passes and no repair agent runs

#### Scenario: OpenSpec change is also validated by the OpenSpec CLI
- **WHEN** the change kind is `openspec` and `openspec validate --type change <name>` fails
- **THEN** the definition check fails and the CLI's output is reported as the problem

#### Scenario: Spec-driven requirement lacks a scenario
- **WHEN** the change kind is `spec-driven` and a requirement has no SHALL or MUST, no scenario, or a scenario without WHEN or THEN behavior
- **THEN** the definition check names the spec file, the requirement and the missing part

### Requirement: An invalid definition fails the run after the allowed repairs
The workflow SHALL fail the run when the definition stays invalid after the allowed repairs.

#### Scenario: Repairs run out
- **WHEN** the definition is still invalid after three lead repairs
- **THEN** the run fails

#### Scenario: Repair cannot proceed
- **WHEN** a repair agent reports it is blocked
- **THEN** the run fails with `REPAIR_BLOCKED: <reason>` before the definition is checked again

### Requirement: An OpenSpec definition is committed by the workflow
The workflow SHALL commit an `openspec` change's definition.

#### Scenario: OpenSpec definition is committed
- **WHEN** the change kind is `openspec` and the change folder has uncommitted files
- **THEN** the workflow commits that folder, plus a new `openspec/config.yaml` if there is one, with a message naming the change

#### Scenario: Definition is already committed
- **WHEN** the change folder has no staged, unstaged or untracked files and is in `HEAD`
- **THEN** the workflow commits nothing and the step passes

#### Scenario: Change folder escapes the repository
- **WHEN** `change_dir` is absolute or contains an empty, `.` or `..` segment
- **THEN** the commit step fails

### Requirement: No tracked change remains before implementation
The workflow SHALL require that no tracked file has uncommitted changes before implementation starts.

#### Scenario: Spec-driven definition is not committed by the workflow
- **WHEN** the change kind is `spec-driven`
- **THEN** the commit step passes without committing, and the next check fails the run if any tracked file has uncommitted changes

#### Scenario: Tracked file is dirty
- **WHEN** a tracked file has uncommitted changes when implementation is about to start
- **THEN** the run fails telling the operator to commit or remove them

### Requirement: Implementor writes a checklist before implementing
The workflow SHALL have the implementor write `<change_dir>/checklist.md` from the definition before any implementation.

#### Scenario: Checklist precedes implementation
- **WHEN** the checklist step ends
- **THEN** the checklist exists before the implement step starts

### Requirement: The checklist is a well-formed table
The workflow SHALL require the checklist to be a table with an `ID` column whose rows all have the header's number of cells.

#### Scenario: Checklist table is malformed
- **WHEN** the checklist is empty, uncommitted, has no table with an `ID` column, or has a row with a different number of cells than the header
- **THEN** the check names each problem, one repair runs in the implementor's session, and a second failure fails the run

### Requirement: The checklist step changes no other file
The checklist step SHALL change no file other than the checklist, and it commits nothing itself.

#### Scenario: Checklist step changes another file or commits
- **WHEN** the step changes a file other than the checklist that was not already changed when it started, or `HEAD` moved
- **THEN** the run fails naming the files, with no repair

### Requirement: The checklist is committed
The workflow SHALL commit the checklist.

#### Scenario: Checklist step writes only the checklist
- **WHEN** the checklist step ends with the checklist written and no other tracked or untracked change beyond what existed when the step started
- **THEN** the workflow commits only the checklist

### Requirement: The committed checklist is saved as the plan
The workflow SHALL save the committed checklist as the plan.

#### Scenario: Plan is saved
- **WHEN** the checklist passes its check
- **THEN** a copy is saved as `planned-checklist.md`

### Requirement: Planned rows stay unchanged through implementation
The workflow SHALL keep every planned row and its planned cells unchanged through implementation.

#### Scenario: Implementation fills only Code, Evidence and Status
- **WHEN** implementation finishes and every planned row still has its planned cells
- **THEN** the evidence check does not report a plan problem

#### Scenario: Planned row is changed or removed
- **WHEN** a planned row's non-done cells differ, or the row is gone
- **THEN** the check reports the row's ID and tells the implementor to restore its planned cells

#### Scenario: Row is added during implementation
- **WHEN** the checklist has a row that matches no planned row
- **THEN** the check reports the row as not in the planned checklist

### Requirement: Implementation continues the checklist session
The workflow SHALL run the implementation in the implementor's session that wrote the checklist.

#### Scenario: Implement resumes the session
- **WHEN** the checklist passes
- **THEN** the implement step resumes the checklist step's session

### Requirement: Implementation leaves a commit
The workflow SHALL fail when the implementation leaves no commit.

#### Scenario: Implementation commits work
- **WHEN** at least one commit exists since the implement step started
- **THEN** the commits check passes

#### Scenario: Implementation makes no commit
- **WHEN** no commit exists since the implement step started
- **THEN** the check fails with the commit it counted from, and one repair runs

#### Scenario: Start cannot be read
- **WHEN** the checkout where the step started is not a git checkout with a commit
- **THEN** the check fails saying it could not read where the node started

### Requirement: Each row has a valid status and the evidence it needs
The workflow SHALL check that each checklist row has a valid status and the evidence its status requires.

#### Scenario: Verified row cites evidence
- **WHEN** a row is `verified` and cites, in backticks, a non-empty file inside the evidence folder
- **THEN** the row passes

#### Scenario: Verified row cites nothing usable
- **WHEN** a `verified` row cites no file, only an empty file, or a path outside the evidence folder
- **THEN** the check reports the row's ID

#### Scenario: Failed or not-verified row gives no reason
- **WHEN** a row is `failed` or `not verified` and its Evidence cell is empty
- **THEN** the check reports that the row does not say why

#### Scenario: Row cites a manual test
- **WHEN** the checklist cites an acceptance test (`AT-n`) or a human-only test (`HT-n`)
- **THEN** the check fails and lists the cited IDs

### Requirement: Evidence repairs are limited to two
The workflow SHALL allow up to two evidence repairs.

#### Scenario: Repair completes the evidence
- **WHEN** the first evidence repair completes the checklist
- **THEN** the loop ends and the audit starts

#### Scenario: Evidence repairs run out
- **WHEN** the evidence is still incomplete after two repairs
- **THEN** the run fails

### Requirement: A separate crosscheck audits by inspection
The workflow SHALL have a separate crosscheck agent audit the implementation against the definition and the checklist without running anything.

#### Scenario: Audit runs nothing
- **WHEN** the crosscheck audits
- **THEN** it reads the code, the checklist and the evidence, and runs no test, build or product command

### Requirement: Audit findings go to the implementor
The workflow SHALL pass the crosscheck's findings to the implementor.

#### Scenario: Audit has findings
- **WHEN** the crosscheck lists findings
- **THEN** the implementor resolves them in its own session and the text of the findings reaches that step

#### Scenario: Audit has no findings
- **WHEN** the crosscheck answers `No findings.`
- **THEN** the implementor changes nothing

### Requirement: Evidence is checked again after the findings are resolved
After the findings are resolved, the workflow SHALL check the evidence again.

#### Scenario: Recheck runs
- **WHEN** the implementor has resolved the findings
- **THEN** the evidence check runs with the findings as input

### Requirement: Only a named row may change its planned cells
The workflow SHALL allow a planned row's planned cells to change only where a finding names that row's ID.

#### Scenario: Finding names the row
- **WHEN** a finding names row `I-2` and the implementor changes `I-2`'s planned cells
- **THEN** the evidence check does not report `I-2`

#### Scenario: No finding names the row
- **WHEN** a planned row changed and no finding names its ID
- **THEN** the check reports the row as changed

#### Scenario: Rows may be added after an audit
- **WHEN** a finding asks for a new row and the implementor adds it
- **THEN** the check does not report the added row

### Requirement: A recorded block stops the run
When an implementor step writes `implementation-blocked.md`, the workflow SHALL fail the next check with the recorded question.

#### Scenario: Implementor records a block
- **WHEN** `implementation-blocked.md` exists after the checklist, implement or resolve-findings step
- **THEN** the check fails, prints the file, and says to update the definition and start a new run

### Requirement: Worktree is clean and committed before verification
Before the session report, the workflow SHALL check that no tracked file has uncommitted changes, and that the implementation left a commit, with one repair for each.

#### Scenario: Tracked file is uncommitted
- **WHEN** a tracked file has uncommitted changes after the audit is resolved
- **THEN** the check fails with the status lines and one repair runs, and a second failure fails the run

### Requirement: Implementor writes a session report
The workflow SHALL have the implementor write its session report to `session-report.md` in the artifacts folder.

#### Scenario: Report lists unverified rows and decisions
- **WHEN** the session report step runs
- **THEN** its prompt requires every row that is not verified and every decision in `implementor-decisions.md`, and the report is written to the fixed file

### Requirement: Verification runs with its review steps off
After the session report, the workflow SHALL run `codagent-verify-change` with the assumption review and simplification skipped.

#### Scenario: Review steps are skipped
- **WHEN** verification runs from the implement workflow
- **THEN** `skip_implementation_review` is `true`

#### Scenario: Unchanged fix stops the rounds
- **WHEN** an acceptance fix changes nothing and asks for no retest
- **THEN** the acceptance rounds end

### Requirement: The run ends with the verification outcome
The workflow SHALL end with the outcome that `codagent-verify-change` declares.

#### Scenario: Acceptance converges
- **WHEN** verification reports `ready: true`
- **THEN** the implement run's authored outcome is succeeded

#### Scenario: Acceptance does not converge
- **WHEN** verification reports `ready: false`
- **THEN** the run still completes and its authored outcome is failed

### Requirement: Autonomous sessions are told to finish
Each agent session that starts fresh SHALL begin its prompt with an instruction that no human is present and the task must be completed.

#### Scenario: Fresh node prompt
- **WHEN** a node with a fresh context runs
- **THEN** its resolved prompt starts with the autonomy preamble
