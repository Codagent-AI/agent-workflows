# define-finish Specification

## Purpose
Defines what happens when the last step is completed: the change is validated, its documents are committed alone, and the branch is published when that is appropriate.

## Requirements

### Requirement: The change is validated before it is committed
The system SHALL, when the last step is completed, run `openspec validate --type change <name> --no-interactive` and every step's artifact check.

#### Scenario: Both pass
- **WHEN** validation exits 0 and every step's file is present
- **THEN** the define goes on to the commit

### Requirement: A failed validation commits nothing
The system SHALL refuse to commit when validation fails or a step's file is missing.

#### Scenario: Validation fails
- **WHEN** OpenSpec validation fails or a step's file is missing
- **THEN** the call is refused with the validation output and the missing items, and no commit is made

### Requirement: Only the change folder is committed
The system SHALL commit only `openspec/changes/<name>/`, with the message `chore: add change documents for <name>`.

#### Scenario: Other work in the tree
- **WHEN** other files are staged, modified, or untracked at finish
- **THEN** the commit holds only the change folder

### Requirement: Other work is left as it was and listed
The system SHALL leave other staged and unstaged work as it was.

#### Scenario: Work kept
- **WHEN** other paths are dirty at finish
- **THEN** they are still dirty or staged as before

### Requirement: Left-over paths are listed
The system SHALL list the paths it left out of the commit in the result.

#### Scenario: Left-over paths
- **WHEN** other paths are dirty at finish
- **THEN** the result lists up to ten of them and a count of the rest

#### Scenario: Config file created by OpenSpec
- **WHEN** `openspec new change` created `openspec/config.yaml`
- **THEN** it is not committed and is listed as left as it was

### Requirement: The state file records completion
The system SHALL mark the state complete, with no current step and a completion time, before the commit.

#### Scenario: Complete state
- **WHEN** the commit succeeds
- **THEN** the committed state file has status complete and the last step's completion time

### Requirement: A failed commit restores the state file
The system SHALL put the state file back to its earlier content when the commit fails.

#### Scenario: A rejected commit
- **WHEN** a commit hook rejects the commit
- **THEN** the state file is back to in progress and the result gives the git output

### Requirement: A failed commit restores the staged entries
The system SHALL stage again whatever the user had staged under the change folder when the commit fails.

#### Scenario: Staged entries kept
- **WHEN** a commit fails and the user had staged files under the folder
- **THEN** those entries are staged again

#### Scenario: Staged state cannot be restored
- **WHEN** some staged entries cannot be put back
- **THEN** the result names those paths

### Requirement: A failed commit can be retried
The system SHALL tell the agent to call `next_step` again after the cause is fixed.

#### Scenario: Retry
- **WHEN** a commit failed and its cause is fixed
- **THEN** the next `next_step` call tries the commit again

### Requirement: Merge conflicts block the commit
The system SHALL refuse to commit when the change folder has unresolved merge conflicts, before it changes the index.

#### Scenario: A conflicted file
- **WHEN** a path under the change folder is unmerged
- **THEN** the call is refused, names the paths, and changes neither the index nor the state file

### Requirement: A branch is pushed
The system SHALL, when the current branch is not the default branch, push it to `origin` with upstream tracking.

#### Scenario: A feature branch
- **WHEN** the define finishes on a branch other than the default
- **THEN** the branch is pushed to `origin`

### Requirement: A pull request is opened after the push
The system SHALL open a pull request against the default branch with `gh` after a successful push.

#### Scenario: Pull request opened
- **WHEN** the push succeeds
- **THEN** a pull request titled `Define OpenSpec change <name>` is opened, its body lists the change's files, and the result gives its URL

### Requirement: The default branch is never pushed
The system SHALL NOT push when the current branch is the default branch.

#### Scenario: On main
- **WHEN** the define finishes on the default branch
- **THEN** the commit is made, nothing is pushed, and the result says the user pushes when ready

### Requirement: A detached HEAD is not pushed
The system SHALL NOT push when HEAD is detached.

#### Scenario: Detached HEAD
- **WHEN** HEAD is detached at finish
- **THEN** the commit is made and the result says nothing was pushed

### Requirement: An unknown default branch is not pushed
The system SHALL NOT push when the default branch cannot be determined.

#### Scenario: Unknown default
- **WHEN** the default branch cannot be told
- **THEN** the commit is made and the result says the branch was not pushed

#### Scenario: No remote
- **WHEN** the repository has no `origin`
- **THEN** the default branch is found from local branches and the define only commits

### Requirement: A failed push is reported once
The system SHALL report a failed push once, keep the commit, and not retry.

#### Scenario: Push fails
- **WHEN** the push fails
- **THEN** no pull request is opened and the result gives the push output

### Requirement: A failed pull request is reported once
The system SHALL report a failed pull request once, keep the push, and not retry.

#### Scenario: Pull request fails
- **WHEN** the push succeeds and `gh pr create` fails
- **THEN** the result says the branch was pushed and gives the failure

### Requirement: Git does not wait for a prompt
The system SHALL run git with terminal prompts off, so a missing credential fails at once.

#### Scenario: No credential
- **WHEN** the push needs a credential that is not available
- **THEN** the push fails without waiting for input

### Requirement: The pull request tool does not wait for a prompt
The system SHALL run `gh` with prompts disabled.

#### Scenario: gh needs input
- **WHEN** `gh` would ask a question
- **THEN** it fails instead of waiting
