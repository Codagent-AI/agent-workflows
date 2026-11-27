## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Commits brought in by finalize's push are late commits
When finalize's push merges in commits the pull request branch has on GitHub, those commits SHALL count as commits after the accepted head, like any other: each commit not on the base branch is listed, and a merge is listed only when resolving it changed files.

#### Scenario: Someone pushed a commit after acceptance
- **WHEN** someone pushed a commit to the pull request branch after acceptance, and finalize's push merged it in
- **THEN** the page's Late commit item lists that commit

#### Scenario: Branch updated on GitHub after acceptance
- **WHEN** someone used "Update branch" on the pull request after acceptance, the merge had no conflicts, and finalize's push merged it in
- **THEN** the page lists no late commit for it
