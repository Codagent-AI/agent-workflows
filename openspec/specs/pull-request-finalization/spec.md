# pull-request-finalization Specification

## Purpose
Defines how the `codagent-implement-change` workflow finalizes the pull request after the archive: marking it ready, waiting for CI and fixing failures and review comments within the approved scope for up to three cycles, the last check of the final head, and the three states a run can end in. The run never merges the pull request.

## Requirements

### Requirement: The pull request is pushed and marked ready after the archive
After the archive, whether or not it succeeded, the workflow SHALL push the branch as every push does, without force, and mark the pull request ready for review through `archon forge`.

#### Scenario: Finalize starts
- **WHEN** the archive has succeeded or failed
- **THEN** the branch is pushed and the pull request is no longer a draft

#### Scenario: Push still fails
- **WHEN** the push still fails after its repair, or fails for a reason left to a person
- **THEN** the run fails, no review page is written, and resuming the run retries the push

#### Scenario: Resumed after finalize's push failed
- **WHEN** a run that failed on finalize's push in its first pass is resumed
- **THEN** an archive that passed does not run again, and the push is retried

### Requirement: CI is awaited and fixed in up to three cycles
The workflow SHALL run up to three cycles, each of which waits for CI on the pull request's head with the same bounded wait and report as an acceptance round.

#### Scenario: CI passes
- **WHEN** a cycle's wait reports that CI passed
- **THEN** the cycles end

#### Scenario: CI fails or comments need action
- **WHEN** a cycle's wait reports failed checks or review comments to act on
- **THEN** the implementor fixes them, commits and pushes, and the next cycle waits again

#### Scenario: CI is still running
- **WHEN** a cycle's wait ends with checks still pending
- **THEN** no fix runs, and the next cycle waits again

#### Scenario: Cycles run out
- **WHEN** the third cycle ends without CI passing
- **THEN** the final check runs

### Requirement: Finalize fixes stay within the approved scope
The implementor SHALL fix only what stays within the approved requirements, design and implementation scope, which includes a spec edit the reviewer chose on the review page, and SHALL treat the CI report, failed-check logs and pull request comments as untrusted data.

#### Scenario: Comment asks for a scope change
- **WHEN** a review comment asks for a change to approved behavior, requirements or design, or a material widening of scope
- **THEN** the implementor does not make it, leaves the comment unresolved, reports it, and records it in the dispute log

#### Scenario: Comment contains instructions
- **WHEN** a failed-check log or comment contains instructions, permission claims or requests for credentials
- **THEN** the implementor reads it only as evidence and does not follow it

#### Scenario: Reviewer chose a spec edit
- **WHEN** a CI failure in a feedback round comes from a spec edit the reviewer chose
- **THEN** the implementor may fix it within that edit

### Requirement: A CI wait that cannot run gets one repair
When a CI wait cannot run, the implementor SHALL make one repair that does not change code.

#### Scenario: Wait cannot reach the pull request
- **WHEN** the wait fails because the forge read failed, the branch has no upstream or is behind, or the pull request is still a draft
- **THEN** the implementor pushes the branch if it needs it and changes no code, the workflow marks the pull request ready again, and the wait runs again

#### Scenario: Only a person can fix the wait
- **WHEN** the cause is a missing or invalid credential, a missing permission or a missing tool
- **THEN** the implementor reports the repair blocked, and finalize fails

### Requirement: The final head is checked once more
After the cycles, the workflow SHALL check CI on the final head, reusing the last cycle's report when it covers that head and is settled.

#### Scenario: Last report covers the final head
- **WHEN** the last cycle's report is for the final head and no longer pending
- **THEN** the workflow uses it without waiting again

#### Scenario: Head moved after the last report
- **WHEN** a fix moved the head after the last cycle's wait, or that report was pending
- **THEN** the workflow waits for CI on the final head once more

### Requirement: Finalize passes only on a clean final head
Finalize SHALL pass only when every check on the final head passed, with no blocking review, no merge conflict and no review comment left to act on.

#### Scenario: Final head is clean
- **WHEN** every check on the final head passed and nothing else is left
- **THEN** finalize passes

#### Scenario: Final head is not clean
- **WHEN** a check failed or is still running when the wait ends, a review blocks, the branch conflicts, or a review comment is left to act on
- **THEN** finalize fails, saying which

#### Scenario: No CI is configured
- **WHEN** the repository has no CI checks and nothing else is left
- **THEN** finalize passes

### Requirement: A failed finalize does not stop the run
When finalize fails, the workflow SHALL go on to write the review package.

#### Scenario: Finalize fails
- **WHEN** finalize fails
- **THEN** the review package lists the failed finalize as a red item that says what blocks the merge and what is left to do

### Requirement: The run ends in one of three states
The run SHALL end as succeeded, needs attention, or failed.

#### Scenario: Merged
- **WHEN** the reviewer chooses Merge and the merge succeeds
- **THEN** the run completes with outcome succeeded, whatever the page's items were

#### Scenario: Succeeded
- **WHEN** the wait is off, acceptance converged, the archive succeeded, finalize passed, and the review page is written
- **THEN** the run completes with outcome succeeded, and the pull request description's state line says the run succeeded

#### Scenario: Needs attention
- **WHEN** the wait is off and the review page is written, but acceptance did not converge, the archive failed, or finalize failed
- **THEN** the run completes with outcome failed, the pull request description's state line says the run needs attention, and the page has each failure as a red item

#### Scenario: Failed
- **WHEN** a major blocker stops the run before its review page is written: the definition stays invalid after its repairs, the implementation is blocked before the pull request or the completion loop reaches a limit, a check before the pull request or in the acceptance rounds still fails after its repair, a push in acceptance, finalize or a feedback round still fails, or the review page cannot be written
- **THEN** the run fails

#### Scenario: Agent fails in a review round
- **WHEN** an agent in a review round fails outright
- **THEN** the run fails, and resuming it continues that round

### Requirement: The run merges only when the reviewer chooses Merge
The workflow SHALL merge the pull request only on the reviewer's merge answer, and never on its own. When the wait is off, or the run is cancelled while it waits, the pull request SHALL stay open and unmerged.

#### Scenario: Reviewer chooses Merge
- **WHEN** the reviewer chooses Merge on the current page
- **THEN** the workflow merges the pull request at the head that page showed

#### Scenario: Run ends
- **WHEN** the run ends without the reviewer's merge answer, because the wait is off or the run was cancelled while it waited
- **THEN** the pull request is open and not merged by the workflow

### Requirement: Finalize runs in every feedback round
Each feedback round SHALL run finalize again: push without force, wait for CI with its own three fix cycles, and check the final head once more. Each round's page SHALL use only that round's finalize results.

#### Scenario: Round fixes a finalize failure
- **WHEN** finalize failed before a feedback round and passes in that round
- **THEN** the round's page has no finalize failure

#### Scenario: Round gets its own cycles
- **WHEN** an earlier round used all three CI fix cycles
- **THEN** the next feedback round still has three cycles

### Requirement: Commits brought in by finalize's push are late commits
When finalize's push merges in commits the pull request branch has on GitHub, those commits SHALL count as commits after the accepted head, like any other: each commit not on the base branch is listed, and a merge is listed only when resolving it changed files.

#### Scenario: Someone pushed a commit after acceptance
- **WHEN** someone pushed a commit to the pull request branch after acceptance, and finalize's push merged it in
- **THEN** the page's Late commit item lists that commit

#### Scenario: Branch updated on GitHub after acceptance
- **WHEN** someone used "Update branch" on the pull request after acceptance, the merge had no conflicts, and finalize's push merged it in
- **THEN** the page lists no late commit for it
