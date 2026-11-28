## MODIFIED Requirements

### Requirement: CI is awaited and fixed in up to three cycles
The workflow SHALL run up to three cycles, each of which waits for CI on the pull request's head with the same bounded wait and report as an acceptance round. Each of these waits SHALL last at least three minutes, so a check that registers late, such as a review app that starts when the pull request leaves draft, is waited for.

#### Scenario: CI passes
- **WHEN** a cycle's wait reports that CI passed
- **THEN** the cycles end

#### Scenario: CI fails or comments need action
- **WHEN** a cycle's wait reports failed checks or review comments to act on
- **THEN** the implementor fixes them and commits, the fix is reviewed when code review is on, the workflow pushes, and the next cycle waits again

#### Scenario: CI is still running
- **WHEN** a cycle's wait ends with checks still pending
- **THEN** no fix runs, and the next cycle waits again

#### Scenario: Cycles run out
- **WHEN** the third cycle ends without CI passing
- **THEN** the final check runs

#### Scenario: A review app registers late
- **WHEN** every check on the head has passed one minute into the wait, and a review app registers its check a minute later
- **THEN** the wait goes on until that check finishes, and its report includes the app's check and comments
