## MODIFIED Requirements

### Requirement: A feedback round addresses the feedback and publishes again
After the merge, an implementor SHALL address each answer, note, screenshot comment and command evidence comment on the branch. The round SHALL then run code review and the push, the archive steps when the archive had not passed, finalize, the ranking and the publish, write the next round's page, and wait again. The round's pushes SHALL follow the same rule as every push. There MUST be no limit on the number of feedback rounds. A round that changes no code SHALL still write a new page and wait.

#### Scenario: Feedback addressed
- **WHEN** the reviewer sends feedback
- **THEN** the run addresses it, runs code review, push, finalize, ranking and publish, writes the next round's page and waits again

#### Scenario: Many rounds
- **WHEN** the reviewer has sent feedback on every page so far
- **THEN** the next feedback still starts a round

#### Scenario: Nothing to change
- **WHEN** a round's feedback needs no code change
- **THEN** the round still writes a new page and waits

#### Scenario: Comment on command evidence
- **WHEN** the reviewer's feedback has a comment on a command evidence entry
- **THEN** the implementor addresses it as it addresses a screenshot comment

#### Scenario: Push still fails in a feedback round
- **WHEN** the round's push still fails after its repair, or fails for a reason left to a person
- **THEN** the run fails, no new page is written, and resuming the run starts the round again from the saved feedback and retries the push

### Requirement: Retest reruns the listed journeys
Choosing Retest SHALL make the next round rerun the listed journeys in an acceptance round, and that round's screenshots and command evidence SHALL join the page as a new acceptance round. When that acceptance round passes, the commits the page listed SHALL leave the Late commit item. Commits made in the same round SHALL stay on the next page's Late commit item.

#### Scenario: Retest chosen
- **WHEN** the reviewer chooses Retest and sends feedback
- **THEN** the next round reruns the listed journeys in an acceptance round
- **AND** the page after it shows that round's screenshots and command evidence as a new acceptance round

#### Scenario: Retest passes
- **WHEN** the retest's acceptance round passes
- **THEN** the page after it has no Late commit item for the commits the page listed

#### Scenario: Same-round commits stay
- **WHEN** a round addresses feedback with new commits and also retests
- **THEN** the next page's Late commit item still lists the round's own commits
