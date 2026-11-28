## MODIFIED Requirements

### Requirement: A script checks the ranking
A script SHALL build its own list of required items from files the ranking agent does not write, and SHALL reject a ranking that leaves one out or ranks it lower than its tier:
- the checklist's failed and unverified rows and each failed step must be red;
- an unverified row that names an existing test when finalize passed with checks must be at least yellow;
- each other open dispute-log entry other than a pull request comment, spec-change disputes included, and the commits after the accepted head, must be at least orange;
- each open decision-log entry and each open pull request comment dispute must be at least yellow.

A decision-log or dispute-log entry SHALL be open unless it is marked settled or an earlier round's response record marks it fixed, unchanged or settled, and SHALL be open again once it changes after its latest answer. A response to a question that an item's entries share SHALL settle every entry that shares it. An entry with a question of its own SHALL be settled only by the response to that entry. An item whose latest answer asked for no work SHALL NOT be required until it changes. An item that repeats an earlier answer SHALL be required only at yellow.

#### Scenario: Spec-change dispute in orange
- **WHEN** the ranking puts a dispute that needs a spec change in orange
- **THEN** the check accepts it

#### Scenario: Ranking leaves out a required item
- **WHEN** the ranking omits a failed checklist row
- **THEN** the check rejects it, naming the row, and the ranking agent repairs the ranking once

#### Scenario: Ranking leaves out an open decision
- **WHEN** the ranking has no item for an open decision-log entry
- **THEN** the check rejects it, naming the entry

#### Scenario: Ranking leaves out a pull request comment dispute
- **WHEN** the ranking has no item for an open pull request comment dispute
- **THEN** the check rejects it, naming the entry

#### Scenario: Decision settled in an earlier round
- **WHEN** the reviewer answered a decision's item in round 1 and the response record marks it unchanged
- **THEN** the round 2 ranking need not include it

#### Scenario: Grouped answer
- **WHEN** an item covering two decisions was answered in round 1 and the response record marks it fixed
- **THEN** neither decision is required in round 2

#### Scenario: Declined answer stays open
- **WHEN** the response record marks a decision's answer declined
- **THEN** the decision is still required in the next round

#### Scenario: Disputes with questions of their own
- **WHEN** an item covering two spec-change disputes asked one question for each, and the response record marks one fixed and the other declined
- **THEN** only the fixed dispute is settled, and the declined one is still required in the next round

#### Scenario: Ranking is still wrong after its repair
- **WHEN** the repaired ranking still fails the check
- **THEN** the script keeps every valid item the ranking agent gave, places each missing or underranked required item in its tier itself, and the package is written

#### Scenario: Ranking agent's judgment
- **WHEN** the ranking agent puts a required item above its minimum, such as an open decision in orange
- **THEN** the check accepts the tier the ranking agent gave it

### Requirement: Every item is ranked in one tier
The reviewer, in a fresh session after finalize, SHALL rank every item from the testing evidence, the decision log and the dispute log into exactly one of red, orange and yellow, by the Agent Factory's tier rules without their Agent Validator, task-compliance, resume and plan-revision parts. Every open decision-log and dispute-log entry SHALL be ranked. A decision SHALL be ranked by how costly it would be if it is wrong, whether or not it changes behavior. Items that share one root cause SHALL become one item, in the highest tier any of them reaches, listing each symptom. When finalize passed CI, a checklist row that is not verified but names an automated test a CI suite runs SHALL count as verified by that test. A spec behavior that acceptance tried and saw pass SHALL NOT be an item. A behavior that only automated tests checked, which acceptance never tried, SHALL be a Risk item. Those of one feature SHALL share one item, one item per feature, that says what a person has not yet seen working and which tests check it. A dispute asking for a spec change SHALL be at least orange, since it needs an answer, and red only when its gap should block the merge. An item SHALL be yellow only when its recommended option accepts it as it is, with no further work. An item that would otherwise be yellow but recommends a fix, a retest, a review round or any other work SHALL be orange. A red or orange item MAY recommend accepting it as it is.

#### Scenario: Red items
- **WHEN** a spec behavior failed, a checklist row is failed or not verified, a decision departs from the definition, or a dispute asks for a spec change whose gap should block the merge
- **THEN** the item is red

#### Scenario: Orange items
- **WHEN** a decision changes scope, weakens a guarantee, affects other callers, is costly to reverse, or would be costly if wrong in cost, security, performance, test strength or maintainability; a high or medium review finding was declined, is disputed or was never fixed; an audit finding was not fixed; a pull request comment was not fixed and leaving it could change behavior or weaken a guarantee; or commits follow the accepted head
- **THEN** the item is orange, unless a red rule also applies

#### Scenario: Spec change that need not block the merge
- **WHEN** a pull request comment the finalize fixer declined asks for a spec change to cover a narrow edge case
- **THEN** the item is orange, not red

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

### Requirement: Each failed step is a red item
The workflow SHALL add a red item of type Failure for each failed acceptance, retest, archive or finalize from the run's own results, and, in a feedback round, for a failed base merge, a follow-up issue that could not be filed, a blocked `address-feedback`, a response file the check rejected and a failed description update. The item SHALL start with one line the publisher writes from the run's results, saying what failed. The ranking agent SHALL write the rest of the item: why it failed, whose problem it is, what is left untested or undone and what covers it instead, ending with options that fit the cause. When the ranking agent wrote no valid item for the step, the publisher SHALL write a plain item saying what failed and what is left to do, never the step's raw output, ending with the standard question: "Fix it in the next round" (recommended) or "Leave it for me to handle", then "Other". An item the ranking agent wrote about the same cause SHALL become part of the step's item. Once the reviewer answers a failed step's item without asking for work, later pages SHALL leave it out until the step's problems change.

#### Scenario: Finalize failed
- **WHEN** finalize failed because a check on the final head failed
- **THEN** the item's first line names the check and says the merge is blocked until it passes

#### Scenario: Acceptance fix was blocked
- **WHEN** an acceptance fix reported itself blocked on a decision only the user can make
- **THEN** the item says acceptance stopped on that decision and links to its decision-log entry

#### Scenario: Acceptance push failed
- **WHEN** an acceptance round's push still fails after its repair, and the push after the rounds fails too
- **THEN** no red item is written for it, because the run fails and writes no page

#### Scenario: Acceptance stopped by a push, then resumed
- **WHEN** the acceptance rounds ended because a push failed, and a resume's push succeeded
- **THEN** the acceptance item's first line says acceptance stopped because the push failed

#### Scenario: Acceptance never tested the change
- **WHEN** acceptance failed because the run's setup kept the tester from testing
- **THEN** the item says nothing was tested and why, lists what went untested and what covers it instead
- **AND** its options do not offer fixing it in the next round

#### Scenario: Standard question
- **WHEN** the ranking has no valid item for a failed step
- **THEN** the page shows the publisher's plain item, ending with the standard question with "Fix it in the next round" recommended, and no raw output

#### Scenario: Same cause written twice
- **WHEN** the ranking agent wrote an orange item about the cause of a failed step
- **THEN** the page shows one red item for both

#### Scenario: Failure left to the reviewer
- **WHEN** the reviewer answers a failed step's item with "Leave it for me to handle" and the next round leaves its problems as they were
- **THEN** the next page does not show the item
- **AND** a later page shows it again if its problems change

#### Scenario: Push failed in a feedback round
- **WHEN** a feedback round's push still fails after its repair
- **THEN** the run fails, and the round writes no page

### Requirement: A dispute log records what the agents left unfixed without agreement
The workflow SHALL commit `dispute-log.md` in the change folder, numbered `DISPUTE-1`, `DISPUTE-2` and so on, with one entry for each `high` or `medium` review finding still disputed or never fixed, each audit finding the implementor did not fix, and each pull request review comment the finalize fixer did not fix. Each entry SHALL give the finding or comment and both sides. An entry a script makes from a review finding, in either log, SHALL state the finding's problem once.

#### Scenario: Finding stays disputed
- **WHEN** the reviewer still contests a decline after the implementor's reply
- **THEN** the dispute log has an entry with the finding, the reviewer's position and the implementor's

#### Scenario: Audit finding is not fixed
- **WHEN** the implementor holds that an audit finding is not a violation and does not fix it
- **THEN** it records the finding, the requirement and its reason in the run's dispute log, and the committed log has the entry

#### Scenario: Pull request comment is not fixed
- **WHEN** the finalize fixer does not fix a review comment on the pull request
- **THEN** it adds an entry headed `PR comment` to the committed dispute log, with the comment's file, line and author, what it asked for and why it was not fixed, and commits it with its fixes or by itself; its reply on the comment stays as well

#### Scenario: Nothing is disputed
- **WHEN** no finding is disputed at the end of the run
- **THEN** the dispute log has no entries, and no dispute item is ranked

#### Scenario: Entry from a review finding
- **WHEN** a script logs a review finding
- **THEN** the entry states the finding's problem once, as what breaks if the decision is wrong

### Requirement: The fallback keeps the agent's valid questions and picks
When the script places items itself, it SHALL write each one plainly: a title from the entry's heading or the behavior it covers, without its code, a one-line body saying what is open, and a labeled link to its source, never a code, a file path or a whole log entry in the text. It SHALL give the standard question to each item without a valid one, and to a dispute that needs a spec change an option to make the edit its entry records, worded without quoting it, the follow-up and the drop options, or only the last two when it records no edit. It SHALL keep the key evidence that names the run's screenshots or command evidence, at most five, and drop the rest. When no pick is valid, the page SHALL have no key evidence section, and all evidence SHALL still show.

#### Scenario: Item placed by the script
- **WHEN** the script places a required item the ranking left out
- **THEN** the item ends with the standard question

#### Scenario: Decision placed by the script
- **WHEN** the script places a decision-log entry headed `DECIDE-5: Fixture cleanup uses a temporary folder`
- **THEN** the item's title is "Fixture cleanup uses a temporary folder", its text has no `DECIDE-5`, and it links to the entry on GitHub

#### Scenario: Spec-change dispute placed by the script
- **WHEN** the script places a dispute that needs a spec change and its entry records an edit
- **THEN** the item is orange, and its question offers making that edit, filing a follow-up issue, and dropping it

#### Scenario: Some picks invalid
- **WHEN** the repaired ranking still names two real screenshots and one that does not exist
- **THEN** the page's key evidence shows the two real screenshots

#### Scenario: No valid pick
- **WHEN** none of the ranking's key evidence names real evidence
- **THEN** the page has no key evidence section
- **AND** all evidence still shows

### Requirement: Flagged items are rewritten once
When items are flagged, the ranking agent SHALL rewrite their wording once from the reader's notes, and MAY relabel links, but MUST keep every tier, type, source, link target, journey, piece of evidence and option ID. The rewritten ranking SHALL pass the same check as the ranking. When it does not, each item SHALL keep its rewrite only if the ranking still passes with it, and otherwise its wording from before the rewrite.

#### Scenario: Rewrite passes the check
- **WHEN** the reader flags two items and their rewrite passes the check
- **THEN** the page shows the two rewritten items and the others unchanged

#### Scenario: Rewrite changes an option
- **WHEN** the rewrite of an item gives its question a different option ID
- **THEN** that item keeps its earlier wording

#### Scenario: One rewrite fails the check
- **WHEN** the reader flags two items and the rewrite of one drops the line of files changed from a late commit
- **THEN** the page shows the other item rewritten and the late commit with its wording from before the rewrite

## ADDED Requirements

### Requirement: A repeat of an answered item shows the earlier answer
The ranking agent MAY match a decision or dispute to an earlier item whose latest answer asked for no work, when both raise the same problem. A matched item SHALL be yellow, and the page SHALL show on it the round of the earlier answer and what it was, with a link to any issue filed for it. A script SHALL ignore a match for any other item, or to an item whose latest answer asked for work.

#### Scenario: Gap already sent to a follow-up
- **WHEN** round 3's code review finds a gap that the reviewer sent to a follow-up issue in round 2, and the ranking matches the new decision to the old one
- **THEN** page 3 shows the new decision in yellow with "You answered this in round 2" and that answer, linking to the issue

#### Scenario: Earlier answer asked for work
- **WHEN** the ranking matches an item to one whose latest answer asked for a fix
- **THEN** the script ignores the match and the item keeps its tier

#### Scenario: Failure matched
- **WHEN** the ranking matches a failed step to an earlier item
- **THEN** the script ignores the match
