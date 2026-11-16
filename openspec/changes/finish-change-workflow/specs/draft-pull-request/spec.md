## ADDED Requirements

### Requirement: The pull request stays a draft until finalize
The pull request SHALL stay a draft through the acceptance rounds, and finalize SHALL mark it ready for review.

#### Scenario: Acceptance rounds
- **WHEN** an acceptance round pushes a fix
- **THEN** the pull request is still a draft

#### Scenario: Finalize marks it ready
- **WHEN** finalize starts
- **THEN** a script marks the pull request ready for review through `archon forge`

#### Scenario: Forge refuses to mark it ready
- **WHEN** the forge refuses the ready operation
- **THEN** finalize fails, and the run goes on to write the review package

### Requirement: The review package rewrites the generated description
At the end of the run, the workflow SHALL rewrite the generated block of the pull request description with "Review first" on top, the implementor's change summary below it, and the collapsed sections after the summary.

#### Scenario: Package is written
- **WHEN** the review package is written
- **THEN** the generated block holds "Review first", then the change summary, then the collapsed sections

#### Scenario: Person added text
- **WHEN** the description has text outside the generated-body markers
- **THEN** that text stays as it was

## MODIFIED Requirements

### Requirement: Unresolved threads and human comments are actionable feedback
The wait SHALL count unresolved threads and human conversation comments as actionable feedback, including those from the pull request's author. The run's own replies, which end with the line `<!-- codagent-reply -->`, SHALL NOT count as feedback.

#### Scenario: Thread answered by the author
- **WHEN** the latest significant comment of an unresolved thread is from the pull request's author and does not end with the marker
- **THEN** the thread counts as feedback

#### Scenario: Author's top-level comment
- **WHEN** a top-level comment is from the pull request's author and does not end with the marker
- **THEN** it counts as feedback

#### Scenario: Thread answered by the run
- **WHEN** the latest significant comment of an unresolved thread ends with the marker
- **THEN** the thread is deferred and does not count as feedback

#### Scenario: Run's own top-level comment
- **WHEN** a top-level comment ends with the marker
- **THEN** it does not count as feedback

#### Scenario: Bot comment
- **WHEN** a top-level comment is from an author whose type is `Bot`
- **THEN** it is listed as informational and does not count as feedback
