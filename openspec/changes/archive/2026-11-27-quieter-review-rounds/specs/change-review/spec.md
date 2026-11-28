## MODIFIED Requirements

### Requirement: Each review place keeps one result
The workflow SHALL keep one review result for before the pull request, one for the acceptance rounds, one for the feedback rounds and one for finalize's CI fixes, under the run's artifacts folder. Each review SHALL overwrite the result for its place. A result SHALL name the revisions it covered, list the open and disputed findings, and list the accepted declines with their reasons.

#### Scenario: Result after a review
- **WHEN** a review ends
- **THEN** its place's result names the start and end revisions it covered, lists the open and disputed findings or says `No open findings.`, and lists each accepted decline with its reason

#### Scenario: Later round
- **WHEN** a review runs in a later acceptance round
- **THEN** it replaces the acceptance result from the earlier round

#### Scenario: Later feedback round
- **WHEN** a review runs in a later feedback round
- **THEN** it replaces the feedback result from the earlier round

#### Scenario: Later CI fix
- **WHEN** a review runs on a later finalize cycle's fix
- **THEN** it replaces the finalize result from the earlier cycle

## ADDED Requirements

### Requirement: Finalize's fixes are reviewed in their cycle
When code review is on and a finalize CI cycle's fixer commits, a fresh reviewer SHALL review the commits since the head that cycle's CI ran on, with one fixer turn and one re-review, before the fix is pushed. Findings that were not fixed SHALL go to the logs as in any other review. The commits the review and its re-review covered SHALL NOT be Late commit items.

#### Scenario: Pull request comment fixed
- **WHEN** a cycle's fixer commits a fix for a pull request comment
- **THEN** a fresh reviewer reviews only that fix before the push, and the next page has no Late commit item for it

#### Scenario: Finding on the fix
- **WHEN** the review finds a defect in the fix and the fixer fixes it
- **THEN** the re-review checks it, and neither commit is a Late commit item

#### Scenario: Fixer only records disputes
- **WHEN** a cycle's fixer commits only to the change folder
- **THEN** no reviewer runs

#### Scenario: Review is off
- **WHEN** code review is off
- **THEN** the fix is pushed without a review, and it is a Late commit item
