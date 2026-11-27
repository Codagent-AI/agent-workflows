## MODIFIED Requirements

### Requirement: Every item is ranked in one tier
The reviewer, in a fresh session after finalize, SHALL rank every item from the testing evidence, the decision log and the dispute log into exactly one of red, orange and yellow, by the Agent Factory's tier rules without their Agent Validator, task-compliance, resume and plan-revision parts. Every open decision-log and dispute-log entry SHALL be ranked. A decision SHALL be ranked by how costly it would be if it is wrong, whether or not it changes behavior. Items that share one root cause SHALL become one item, in the highest tier any of them reaches, listing each symptom. When finalize passed CI, a checklist row that is not verified but names an automated test a CI suite runs SHALL count as verified by that test. A spec behavior that acceptance tried and saw pass SHALL NOT be an item. A behavior that only automated tests checked, which acceptance never tried, SHALL be a Risk item. Those of one feature SHALL share one item, one item per feature, that says what a person has not yet seen working and which tests check it. An item SHALL be yellow only when its recommended option accepts it as it is, with no further work. An item that would otherwise be yellow but recommends a fix, a retest, a review round or any other work SHALL be orange. A red or orange item MAY recommend accepting it as it is.

#### Scenario: Red items
- **WHEN** a spec behavior failed, a checklist row is failed or not verified, or a decision departs from the definition
- **THEN** the item is red

#### Scenario: Orange items
- **WHEN** a decision changes scope, weakens a guarantee, affects other callers, is costly to reverse, or would be costly if wrong in cost, security, performance, test strength or maintainability; a high or medium review finding was declined, is disputed or was never fixed; an audit finding was not fixed; a pull request comment was not fixed and leaving it could change behavior or weaken a guarantee; or commits follow the accepted head
- **THEN** the item is orange, unless a red rule also applies

#### Scenario: Decision that changes no behavior
- **WHEN** a decision changes nothing the product does but weakens a test or adds a heavy dependency
- **THEN** the item is orange

#### Scenario: Yellow items
- **WHEN** acceptance did not exercise a behavior whose checklist row a passing automated test verifies, or a decision or dispute meets no red or orange rule
- **THEN** the item is yellow, linking to the test where one covers it

#### Scenario: Orange item that recommends accepting
- **WHEN** a commit landed after acceptance and the agent recommends keeping it as it is
- **THEN** the item stays orange, with keeping it as its recommended option

#### Scenario: Yellow item that recommends work
- **WHEN** a decision meets no red or orange rule, but the agent recommends fixing it in the next round
- **THEN** the item is orange, with the fix as its recommended option

#### Scenario: Unverified row has a named test
- **WHEN** a checklist row is not verified, names an automated test that a CI suite runs, and finalize passed CI
- **THEN** the row counts as verified by that test: its item is yellow, not red, and it stays on the page

#### Scenario: Named test outside CI
- **WHEN** a checklist row is not verified and names an automated test that no CI suite runs
- **THEN** the item is red, because no run records that test passing at the final head

#### Scenario: Unfixed comment is a style preference
- **WHEN** the finalize fixer did not fix a pull request comment that asked only for a style preference
- **THEN** the ranking agent may put it in yellow, with its Dispute type

#### Scenario: White items
- **WHEN** acceptance tried a spec behavior and saw it pass
- **THEN** it is not an item, since there is no white tier, and the page's evidence shows what verified it

#### Scenario: Behaviors never tried live
- **WHEN** three behaviors of Retest and two of the screenshot viewer passed only automated tests and acceptance never tried them
- **THEN** one Risk item lists the three Retest behaviors and another lists the two viewer behaviors, each yellow when the agent recommends accepting the tests
- **AND** each says what a person has not yet seen working and names the tests that check them

#### Scenario: Symptoms share a cause
- **WHEN** a failed behavior and a disputed finding come from the same defect
- **THEN** they are one red item that lists both

### Requirement: The ranking picks the key evidence
The ranking agent SHALL pick up to five of the run's acceptance screenshots and command evidence entries as key evidence, each with a title and a line on what it shows. It SHALL prefer evidence of the change working as a person would see it, such as full views of the product in a live or real run, over test images and close-ups of one detail. When the run has neither, it SHALL pick none.

#### Scenario: Screenshots picked
- **WHEN** the run has twenty acceptance screenshots and six command evidence entries
- **THEN** the ranking names up to five of them in all, each with a title and a line on what it shows

#### Scenario: Live views preferred
- **WHEN** the run has screenshots of the live product and screenshots of a test image and of one header at phone width
- **THEN** the key evidence includes the live views before either close-up

#### Scenario: Only command evidence
- **WHEN** the run has command evidence and no screenshots
- **THEN** the ranking picks from the command evidence

#### Scenario: No screenshots
- **WHEN** the run has no acceptance screenshots and no command evidence
- **THEN** the ranking picks no key evidence

### Requirement: Items are written for a person
The ranking agent SHALL write each item for the person reviewing, who has read the change's proposal, knows the product and knows how this workflow builds a change, but has not read the decision or dispute logs, the code or the run's files, and was not there while the agents worked. Each item SHALL let that person decide from the page alone: what is at stake, what each option would do and what happens if the choice is wrong. Agents SHALL be named by their role, and "you" SHALL mean only the person reviewing. Since answers reach the next round and Merge is a separate button, an option SHALL say what the next round does with it and SHALL NOT say that it merges. Each item has a title saying what happened or what is at stake, a body in plain words and short lists in terms of what a user of the product types or sees, and a short list of what checks the behavior and what does not.

#### Scenario: Item about a decision
- **WHEN** the ranking writes an item for a decision about invalid config files
- **THEN** its title says what the product does with such a file, not what the agent did

#### Scenario: Term from the logs
- **WHEN** a decision-log entry calls a rule the "checker floor"
- **THEN** the item says what the rule does instead, or explains the term where it first appears

#### Scenario: Option to accept the tests
- **WHEN** an item asks whether automated tests are enough for a behavior
- **THEN** its option to accept them says the next round does no extra work for it, not that the pull request merges

#### Scenario: Coverage
- **WHEN** an item's behavior is checked by some tests and not by others
- **THEN** the item lists in a few lines what checks it and what does not, without test file paths

#### Scenario: Defect found by acceptance
- **WHEN** acceptance found a defect
- **THEN** the item says what the tester did, what it expected and what it saw, and names the command evidence entry that shows the output, which the page shows in the item

## ADDED Requirements

### Requirement: A late commit offers a review round
Every Late commit item SHALL offer the option "Run a review round", which says that the next round's reviewer reviews the commit, the implementor fixes what it finds, and the reviewer checks the fixes. When the ranking leaves it out, the run SHALL add it: to the item's first question that is not about a dispute or a retest when that question has room, and otherwise as a question of its own before any Retest question.

#### Scenario: Unreviewed late commit
- **WHEN** a fix lands after acceptance and no code review covered it
- **THEN** its Late commit item offers "Run a review round"

#### Scenario: Ranking leaves it out
- **WHEN** the ranking's Late commit item asks only whether to keep the commit
- **THEN** the page's item also offers "Run a review round" in that question

### Requirement: No review round with code review off
When the run's code review is off, a Late commit item SHALL NOT offer "Run a review round". A question that removing it leaves with one option SHALL offer keeping the commit and leaving it to the person reviewing.

#### Scenario: Code review off
- **WHEN** the run's review strategy is none and a fix lands after acceptance
- **THEN** its Late commit item offers keeping the commit or leaving it to the person reviewing, and no review round

### Requirement: A reader check reads every page's items
Once the ranking is checked or placed, a reviewer agent in a fresh session, playing the person reviewing, SHALL read each item's own words with only the change's proposal besides. It SHALL say what each question asks, what each option would do and what happens if the choice is wrong, and list every term or claim it cannot understand. A page with no items SHALL have no reader check.

#### Scenario: Items read
- **WHEN** the ranking for a page with six items passes its check
- **THEN** the reader answers the three fields for each of the six items and lists the terms it cannot understand

#### Scenario: Page labels left out
- **WHEN** the reader reads an item
- **THEN** it does not see the item's level, kind, source codes, link targets or Other box

### Requirement: Unclear items are flagged
A script SHALL flag each item for which the reader listed a term it cannot understand or left a field empty, including an item it gave no entry for.

#### Scenario: Unclear term
- **WHEN** the reader cannot tell what "named test" means in an item
- **THEN** the script flags that item

#### Scenario: Clear item
- **WHEN** the reader fills every field for an item and quotes no term
- **THEN** the item is not flagged

### Requirement: Flagged items are rewritten once
When items are flagged, the ranking agent SHALL rewrite their wording once from the reader's notes, and MAY relabel links, but MUST keep every tier, type, source, link target, journey, piece of evidence, option ID and spec edit. The rewritten ranking SHALL pass the same check as the ranking. When it does not, each item SHALL keep its rewrite only if the ranking still passes with it, and otherwise its wording from before the rewrite.

#### Scenario: Rewrite passes the check
- **WHEN** the reader flags two items and their rewrite passes the check
- **THEN** the page shows the two rewritten items and the others unchanged

#### Scenario: Rewrite changes an option
- **WHEN** the rewrite of an item gives its question a different option ID
- **THEN** that item keeps its earlier wording

#### Scenario: One rewrite fails the check
- **WHEN** the reader flags two items and the rewrite of one drops the line of files changed from a late commit
- **THEN** the page shows the other item rewritten and the late commit with its wording from before the rewrite

### Requirement: The reader check does not stop the page
The reader check's script steps MUST NOT fail their node. Output they cannot use SHALL leave the ranking as it was.

#### Scenario: Reader output cannot be read
- **WHEN** the reader's output is not valid
- **THEN** no item is flagged and the page publishes the ranking as checked
