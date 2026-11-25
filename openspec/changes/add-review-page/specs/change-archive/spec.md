## MODIFIED Requirements

### Requirement: A failed archive transition gets one delta repair
When validation or the archive fails, the implementor SHALL repair the change's delta once, and the script SHALL try the archive again. In a feedback round, the repair SHALL also get the reviewer's answer on the archive's red item.

#### Scenario: Delta no longer matches the current spec
- **WHEN** the archive fails because a delta no longer matches the main spec, such as a MODIFIED requirement that omits a current scenario or a header that no longer matches
- **THEN** the implementor edits only files under `openspec/changes/<name>/`, does not edit `openspec/specs/`, run `openspec archive`, move or delete folders, or commit, and the archive is tried again

#### Scenario: Failure is not a delta problem
- **WHEN** the cause is a missing tool, an existing archive folder for the change, a permission error, or a spec conflict that needs a person's decision and no answer from the reviewer settles it
- **THEN** the implementor changes nothing and reports the repair blocked, and the archive fails

#### Scenario: Reviewer settled a spec conflict
- **WHEN** the archive was blocked on a spec conflict and the reviewer's answer says how to settle it
- **THEN** the feedback round's repair edits the delta as the answer says, still only under `openspec/changes/<name>/`, and the archive is tried again

## ADDED Requirements

### Requirement: A feedback round reruns an archive that did not pass
When the archive had not passed, each feedback round SHALL run the archive steps again before finalize: the validation and archive, the delta repair, the archive commit, and its check and repair. When the archive had passed, a feedback round MUST NOT archive again.

#### Scenario: Archive failed before
- **WHEN** a feedback round starts and the archive had failed
- **THEN** the archive steps run again before finalize

#### Scenario: Archive still fails
- **WHEN** the archive still fails in a feedback round after its repairs
- **THEN** the next page shows the failed archive as a red item and has no Merge button

#### Scenario: Archive passed before
- **WHEN** a feedback round starts and the archive had passed
- **THEN** the round does not archive again

### Requirement: A chosen spec edit follows the archive's state
A spec edit the reviewer chose SHALL go into the change's delta when the change is not archived yet, so the archive applies it. After the archive, it SHALL go into `openspec/specs/` directly, the archived change SHALL keep the spec as it was archived, and the dispute log in the archive folder SHALL record the edit the reviewer chose.

#### Scenario: Edit before the archive passes
- **WHEN** the reviewer chooses a spec edit and the change is not archived
- **THEN** the round edits the change's delta, and the archive applies it

#### Scenario: Edit after the archive
- **WHEN** the reviewer chooses a spec edit and the change is archived
- **THEN** the round edits `openspec/specs/` directly and does not archive again
- **AND** the dispute log in the change's archive folder records the edit the reviewer chose

### Requirement: Log entries after the archive go to the archive folder
After the archive, a feedback round SHALL add its decision and dispute log entries to the logs in the change's archive folder.

#### Scenario: Decision in a later round
- **WHEN** a feedback round after the archive settles a question on its own
- **THEN** its entry goes into the decision log in the change's archive folder
