## MODIFIED Requirements

### Requirement: Each round's publish rewrites the generated description
Each round's publish SHALL rewrite the generated block of the pull request description with the implementor's change summary, the run's state line, and a list of every round's review page, oldest first, each new round added at the end. The change summary SHALL describe the change and its commits and SHALL NOT report test or validation results, which later steps make stale.

#### Scenario: Package is written
- **WHEN** round 2's page is written
- **THEN** the generated block holds the change summary, the state line, and links to the round 1 and round 2 pages in that order

#### Scenario: Page entries
- **WHEN** the reviewer sent feedback from round 1's page and round 2's page is written
- **THEN** round 1's entry says feedback was sent, and round 2's entry is marked as the current page

#### Scenario: Merge chosen
- **WHEN** the reviewer chooses Merge on a page and the merge succeeds
- **THEN** that page's entry says it was merged from that page

#### Scenario: Merge refused
- **WHEN** the reviewer chooses Merge on a page and the forge refuses it
- **THEN** the next publish's entry for that page says Merge was chosen and refused, with the reason

#### Scenario: Archon's address is unknown
- **WHEN** the run does not know Archon's address
- **THEN** each entry names its round and the run, and the description says to open the pages from Archon's UI or with the `implement-change` skill

#### Scenario: Summary leaves out test results
- **WHEN** the implementor writes the change summary for the draft pull request
- **THEN** the summary describes the change and its commits, and no test results appear in the description

#### Scenario: Person added text
- **WHEN** the description has text outside the generated-body markers
- **THEN** that text stays as it was
