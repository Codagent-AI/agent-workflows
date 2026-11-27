## MODIFIED Requirements

### Requirement: The run records each answer
When the run accepts an answer, a script SHALL save it as a file for its round in the run's artifacts folder and record it in the page it came from, before anything else in the round runs. The implementor SHALL read the answers from that file. Each answer from the page SHALL carry the chosen option's label and wording along with its ID, so the implementor reads what the option said the next round would do. A plain-text answer from the Archon CLI or UI SHALL count as a merge when it is `merge`, and otherwise as feedback for the current round, with the text as its note. The summary comment SHALL reach the implementor as a note, and the implementor SHALL record a response to it like any other note.

#### Scenario: Feedback received
- **WHEN** the run accepts feedback from round 1's page
- **THEN** the artifacts folder holds round 1's answers as a file
- **AND** round 1's page shows them as a read-only record before the round's implementor starts

#### Scenario: Option wording carried
- **WHEN** the reviewer chooses "Check it in the next round", whose wording says the tester tries Retest live, and sends feedback
- **THEN** the saved answer holds that label and wording with the option's ID

#### Scenario: Merge received
- **WHEN** the run accepts a merge from a page
- **THEN** that page records that Merge was chosen and when

#### Scenario: Plain-text merge
- **WHEN** the reviewer answers the wait from the Archon CLI with the text `merge`
- **THEN** the run merges the pull request at the head the current page shows

#### Scenario: Summary comment
- **WHEN** feedback includes a summary comment asking to sort the size table
- **THEN** the implementor reads it as a note and records a response entry for it

#### Scenario: Plain-text feedback
- **WHEN** the reviewer answers the wait from the Archon UI with other text
- **THEN** the run starts a feedback round with that text as a note on the current page

### Requirement: The next page reflects the round
The next page's Description section SHALL open with a "Since round <n>" list of what the round did with the feedback, in plain words without decision or dispute codes, each entry in the past tense. A failure the round fixed, a dispute the reviewer settled, and an item the reviewer answered that needed no further work MUST NOT appear on the next page as items. A settled dispute SHALL stay in the dispute log.

#### Scenario: Failure fixed
- **WHEN** the round fixes a failure that was a red item
- **THEN** the next page does not show that item

#### Scenario: Dispute settled
- **WHEN** the reviewer settled a dispute in their feedback
- **THEN** the next page does not show it as an item
- **AND** its dispute log still has the entry

#### Scenario: Summary of the round
- **WHEN** the page for round 2 is written
- **THEN** its Description section opens with "Since round 1" and a list of what round 1 did with the feedback, such as "Kept the screenshot viewer fixes."

#### Scenario: Summary without codes
- **WHEN** the round settles a dispute and records a decision for a later change
- **THEN** the next page's summary says so in plain words, without the dispute's or decision's code

## ADDED Requirements

### Requirement: A review round reviews the chosen late commits
Choosing "Run a review round" on a Late commit item SHALL make the next round's code review start before the earliest commit that item names, so that review covers those commits as well as the round's own changes: the reviewer reviews them, the implementor fixes what it finds, and the reviewer checks the fixes. The implementor SHALL record the answer as needing no change of its own.

#### Scenario: Review round chosen
- **WHEN** the reviewer chooses "Run a review round" on a commit that landed after acceptance, and sends feedback
- **THEN** the next round's code review covers that commit along with the round's own commits
- **AND** the next page has no Late commit item for it

### Requirement: A commit stays until its review round reads it
A commit sent to a review round SHALL leave the Late commit items only once that review has read it, or a later answer picks another option for it, whatever the response says. A note, a merge or a blank answer SHALL NOT take it back.

#### Scenario: Review never read the commit
- **WHEN** the reviewer chooses "Run a review round" on a late commit and the next round's code review fails before it records a result
- **THEN** the next page still has the Late commit item for that commit

