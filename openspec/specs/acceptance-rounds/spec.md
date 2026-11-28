# acceptance-rounds Specification

## Purpose
Defines how the `codagent-implement-change` workflow tests an implemented change after opening its draft pull request: bounded rounds of independent testing, CI and fixes until the change converges or the rounds run out, then one recheck of the checklist rows still not verified.

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
The workflow SHALL have the same tester session write the full handoff after the wait in every round, since the rounds can end after any round.

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
The workflow SHALL push the branch after a fix without force, as every push does.

#### Scenario: Branch has an upstream
- **WHEN** the branch has a configured remote and merge ref
- **THEN** the push targets that ref

#### Scenario: Branch has no upstream
- **WHEN** no remote or merge ref is configured
- **THEN** the push sets the upstream on `origin`

#### Scenario: Push fails
- **WHEN** the push fails because of a failing pre-push hook, a merge conflict or uncommitted tracked changes
- **THEN** one implementor repair runs in the fix session, and a second failure ends the rounds, leaving the push after the rounds to fail the run

### Requirement: A push needs a committed, attached branch
The workflow SHALL fail a push when tracked changes are uncommitted or `HEAD` is detached.

#### Scenario: Tracked changes are uncommitted
- **WHEN** a tracked file has uncommitted changes after the fix
- **THEN** the push is not attempted and the check names the files

#### Scenario: Head is detached
- **WHEN** `HEAD` is detached
- **THEN** the push step fails asking for the change branch

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

### Requirement: Rows still not verified are rechecked after the rounds
After the acceptance rounds end, before the run stops after acceptance or commits the logs, the workflow SHALL list the checklist rows still marked not verified. When there are any, the implementor SHALL rerun the checks those rows name, integration and end-to-end tests included, with a 10-minute limit per command, mark each row verified, failed or not verified with its reason, and commit only the checklist. The workflow SHALL then push the branch, whether or not the run stops after acceptance.

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
- **THEN** the workflow pushes the branch, and a push that still fails after its repair fails the run

#### Scenario: Run goes on after acceptance
- **WHEN** the run goes on to finish and the recheck committed the checklist
- **THEN** the workflow pushes the branch before it commits the logs

### Requirement: The tester records command evidence
In each round, the tester SHALL record as command evidence, next to its screenshots, the commands it ran whose output shows a behavior it checked. Each entry SHALL give a title, what it shows, the revision it ran on, the command, a verbatim excerpt of its output of at most 20 lines chosen to show the behavior, and the file in the round's evidence folder that holds the full output. Command evidence is optional: a round may record only screenshots, or neither.

#### Scenario: Command recorded
- **WHEN** the tester runs the verifier on a broken sample in round 2 to check that it fails
- **THEN** round 2's command evidence has an entry with its title, what it shows, the revision, the command and an excerpt of the output
- **AND** the full output is saved in the round's evidence folder

#### Scenario: No command evidence
- **WHEN** a round records screenshots and no command evidence
- **THEN** the run reports no evidence problem for it

### Requirement: Bad command evidence is left off the page
An entry whose full output is missing, whose excerpt is not in that output, or whose excerpt is longer than 20 lines SHALL be left off the page and reported with the run's other evidence problems.

#### Scenario: Excerpt not in the output
- **WHEN** an entry's excerpt does not appear in its saved output
- **THEN** the page leaves the entry out
- **AND** the run reports it as an evidence problem

#### Scenario: Full output missing
- **WHEN** an entry's saved output is missing
- **THEN** the page leaves the entry out
- **AND** the run reports it as an evidence problem

#### Scenario: Excerpt too long
- **WHEN** an entry's excerpt is 25 lines
- **THEN** the page leaves the entry out
- **AND** the run reports it as an evidence problem

### Requirement: Every push brings in the remote first
Every push the workflow makes to the pull request branch, in the acceptance rounds, finalize and feedback rounds, SHALL push without force. Before it pushes, it SHALL fetch the branch and merge in commits the remote has that the local branch lacks, never rebasing. A merge that conflicts SHALL be aborted and go to the push's agent repair. In those steps agents SHALL commit and never push; the workflow's push SHALL push their commits.

#### Scenario: Branch moved on GitHub
- **WHEN** the remote branch has a commit the local branch lacks, for example after "Update branch" on the pull request
- **THEN** the push merges that commit in, without rebasing or forcing, and pushes

#### Scenario: Merge conflicts
- **WHEN** merging in the remote's commits conflicts
- **THEN** the merge is aborted and the push's agent repair resolves it

#### Scenario: Agent repair commits
- **WHEN** an agent repairs a failed push, a failed CI wait or a pull request whose head does not match, and commits
- **THEN** the agent does not push, and the workflow's push pushes its commit

### Requirement: Transient push errors are retried
A push that fails with a network error, a timeout or a GitHub server error SHALL be retried three times with backoff before it counts as failed.

#### Scenario: Network error
- **WHEN** the push times out twice and then succeeds
- **THEN** the push succeeds and no agent repair runs

### Requirement: Some push failures are left to a person
These push failures SHALL go to no agent. The run SHALL fail and report each in plain words:
- expired or invalid credentials, with the fix: log in again, then resume the run;
- GitHub still unavailable after the retries;
- GitHub refusing a change to `.github/workflows` because the token lacks the `workflow` scope.

#### Scenario: GitHub unavailable
- **WHEN** GitHub returns server errors on the first try and all three retries
- **THEN** the run fails, saying GitHub is unavailable, and no agent runs

#### Scenario: Expired credentials
- **WHEN** the push is refused because the credentials expired
- **THEN** the run fails, saying to log in again and resume the run, and no agent runs

#### Scenario: Missing workflow scope
- **WHEN** GitHub refuses the push because it changes `.github/workflows` and the token lacks the `workflow` scope
- **THEN** the run fails, saying so, and no agent runs

### Requirement: A push that still fails fails the run
Every other push failure, such as a failing pre-push hook, a merge conflict or uncommitted changes, SHALL go to the push's agent repair. A push that still fails after its repair, or that fails for a reason left to a person, SHALL fail the run, and no review page SHALL be written. Resuming the run SHALL retry the push.

#### Scenario: Hook still fails after the repair
- **WHEN** a pre-push hook fails and still fails after the agent repair
- **THEN** the run fails and no review page is written

#### Scenario: Resumed after a failed push
- **WHEN** a run that failed on a push is resumed
- **THEN** it retries the push and goes on

### Requirement: A failed acceptance push ends the rounds
In the acceptance rounds, a push that still fails after its repair, or that fails for a reason left to a person, SHALL end the rounds as not converged instead of failing the run there. The push after the rounds SHALL then try again with no repair and fail the run when it still fails, so resuming the run retries that push without running the rounds again.

#### Scenario: Acceptance push still fails
- **WHEN** an acceptance round's push still fails after its repair
- **THEN** the rounds end as not converged, the push after the rounds tries again with no repair, and when it fails the run fails with no review page

#### Scenario: Resumed after a failed acceptance push
- **WHEN** a run that failed on the push after the acceptance rounds is resumed and the push now succeeds
- **THEN** the run goes on without running the acceptance rounds again, and the page shows that acceptance stopped because the push failed

### Requirement: Screenshots are captured at twice the pixel density
The tester SHALL capture its screenshots at twice the pixel density, such as a device scale factor of 2.

#### Scenario: Page captured
- **WHEN** the tester captures a page in a window 1,200 pixels wide
- **THEN** the screenshot is 2,400 pixels wide

### Requirement: The handoff corrects evidence the page would leave out
After the tester's pass in each acceptance round and each retest, the workflow SHALL read that round's screenshot, command and journey records as the review page does, and give the handoff each problem it finds with its file, or none. Before writing the handoff, the tester SHALL correct each listed record. It MUST correct a command's excerpt to match its saved output, and MUST NOT change a saved output to match its excerpt.

#### Scenario: Reworded excerpt
- **WHEN** a round's command entry quotes wording its saved output doesn't contain
- **THEN** the round's handoff receives that output's file and the problem
- **AND** the tester replaces the excerpt with a run of whole lines from the saved output

#### Scenario: Another round's problem
- **WHEN** round 0 has a bad record and round 1 has none
- **THEN** round 1's handoff receives no problems

#### Scenario: Retest
- **WHEN** a feedback round retests journeys and the retest records a command entry with a bad excerpt
- **THEN** the retest's handoff receives that output's file and the problem
