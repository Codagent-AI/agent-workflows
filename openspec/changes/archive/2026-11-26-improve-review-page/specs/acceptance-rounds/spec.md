## ADDED Requirements

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

## MODIFIED Requirements

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
