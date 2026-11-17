# change-archive Specification

## Purpose
Defines how the `codagent-implement-change` workflow archives the OpenSpec change after the acceptance rounds: the validation and archive, the one repair each for a failed delta and a failed archive commit, the check of the archive commit, and how a failed archive is reported without stopping the run.

## Requirements

### Requirement: The change is archived after the acceptance rounds
After the acceptance rounds end, whether or not acceptance converged, a script SHALL validate the change with `openspec validate --type change <name>` and archive it with `openspec archive <name> --yes`.

#### Scenario: Archive runs after the rounds
- **WHEN** the acceptance rounds end, converged or not
- **THEN** the script validates and archives the change, and the main specs under `openspec/specs/` take its deltas

#### Scenario: Change is already archived
- **WHEN** a resumed run finds the active change folder gone and exactly one archive folder for the change
- **THEN** the script does not archive again and uses that folder

### Requirement: Exactly one archive folder exists for the change
After the transition, the workflow SHALL require exactly one folder `openspec/changes/archive/<date>-<name>` for the change.

#### Scenario: Archive folder is missing or doubled
- **WHEN** no archive folder, or more than one, exists for the change after the transition
- **THEN** the archive fails and names the folders it found

### Requirement: A failed archive transition gets one delta repair
When validation or the archive fails, the implementor SHALL repair the change's delta once, and the script SHALL try the archive again.

#### Scenario: Delta no longer matches the current spec
- **WHEN** the archive fails because a delta no longer matches the main spec, such as a MODIFIED requirement that omits a current scenario or a header that no longer matches
- **THEN** the implementor edits only files under `openspec/changes/<name>/`, does not edit `openspec/specs/`, run `openspec archive`, move or delete folders, or commit, and the archive is tried again

#### Scenario: Failure is not a delta problem
- **WHEN** the cause is a missing tool, an existing archive folder for the change, a permission error, or a spec conflict that needs a person's decision
- **THEN** the implementor changes nothing and reports the repair blocked, and the archive fails

### Requirement: The archive commit holds only the archive's paths
The workflow SHALL commit the archive with only the paths the archive changed under the active change folder, the archive folder and `openspec/specs/`, and SHALL leave every other staged or unstaged change as it was.

#### Scenario: Archive is committed
- **WHEN** the transition has archived the change
- **THEN** the script commits the active change folder's removal, the new archive folder and the updated main specs, and no other path, with Agent Runner's default message: `<TICKET>: Archive change` when the change name starts with a ticket prefix and number, else `[archive] chore: archive openspec documents for <name>`

#### Scenario: Other work is in the worktree
- **WHEN** another file was staged or changed before the archive began
- **THEN** it is not committed and stays staged or changed as it was

### Requirement: A check verifies the archive commit, with one repair
A check SHALL verify the archive commit, and the implementor SHALL repair it once.

#### Scenario: Commit is verified
- **WHEN** the active change folder is gone from the worktree and the index, the archive folder exists, the commits since the archive began change exactly the archive's paths, no archive commit touches another path, and the staged and unstaged changes are the ones from before
- **THEN** the check passes and finalize runs

#### Scenario: Commit is wrong
- **WHEN** any of those conditions fails, for example because a hook rejected the script's message
- **THEN** the check names the problem, and the implementor repairs the commit once, staging and committing only the archive's paths and following the hook's output

### Requirement: A failed archive does not stop the run
When the archive still fails after its repairs, the workflow SHALL keep what the archive left and go on to finalize.

#### Scenario: Archive fails after its repairs
- **WHEN** the transition or the commit check still fails after its repair, or a repair reports it is blocked
- **THEN** the run keeps the files the archive left, finalize runs, and the review package lists the failed archive as a red item that says what failed and what is left to do
