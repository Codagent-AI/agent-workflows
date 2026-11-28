## MODIFIED Requirements

### Requirement: The next page reflects the round
The next page's Description section SHALL open with a "Since round <n>" list of what happened since that round's page, in plain words without decision or dispute codes, each entry in the past tense: the answers whose work was done, the follow-up issues filed, the branch's other commits since that page, what the round's code reviews found and what became of each finding, the base merge and the retest. An answer that needed no work SHALL NOT be listed.

#### Scenario: Summary of the round
- **WHEN** the page for round 2 is written
- **THEN** its Description section opens with "Since round 1" and a list of what round 1 did with the feedback, such as "Fixed the screenshot viewer's zoom."

#### Scenario: Summary without codes
- **WHEN** the round settles a dispute and records a decision for a later change
- **THEN** the next page's summary says so in plain words, without the dispute's or decision's code

#### Scenario: Answer that needed no work
- **WHEN** the reviewer keeps an agent decision as it is and sends feedback
- **THEN** the next page's "Since round" list does not mention it, and the page does not show the decision

#### Scenario: Commit from another step
- **WHEN** finalize's fixer commits a fix for a pull request comment during the round
- **THEN** the "Since round" list names that commit and links to it

#### Scenario: Round's code review
- **WHEN** round 3's code review finds a gap and the implementor declines to fix it
- **THEN** page 3's "Since round 2" list says code review found it and that it is on the page

#### Scenario: Code review finds nothing
- **WHEN** the round's code review runs and finds no problems
- **THEN** the "Since round" list says so

### Requirement: A failed retest is a red item
A retest that does not pass SHALL be a red item, even when acceptance passed before. An acceptance failure SHALL stay on every page until an acceptance round passes, or until the reviewer answers it without asking for work and its problems stay as they were.

#### Scenario: Retest fails
- **WHEN** the retest's acceptance round does not pass
- **THEN** the round does not fix what it found
- **AND** the next page shows the failure as a red item, even when acceptance had passed before

#### Scenario: Acceptance failure persists
- **WHEN** acceptance failed, no acceptance round has passed since, and the reviewer has not answered it without asking for work
- **THEN** every later page still shows the acceptance failure

### Requirement: Feedback that needs a spec change is declined, then asked about
The implementor MUST NOT make a change that would alter approved behavior. It SHALL log a dispute, and the next page SHALL show it as an item, orange unless its gap should block the merge, with three options: a specific spec edit, which the page describes in plain words without quoting it, filing a follow-up issue, or dropping it. A request that needs a new capability or a large revision SHALL get only the follow-up and drop options.

#### Scenario: Feedback would change approved behavior
- **WHEN** an answer asks for behavior the specs rule out
- **THEN** the implementor does not make the change and logs a dispute
- **AND** the next page shows it as an orange item with the spec edit, follow-up and drop options

#### Scenario: Large request
- **WHEN** the request would need a new capability or a large revision
- **THEN** the item offers only the follow-up and drop options

#### Scenario: Spec edit option
- **WHEN** the dispute's entry records an edit that replaces a test rule's wording
- **THEN** the spec edit option says in plain words what the edit changes, without the replacement wording

### Requirement: The reviewer's choice on a spec change is carried out
Choosing the spec edit SHALL make the next round make the edit the dispute's entry records, changing the spec and the code together: in the change's delta when the archive has not passed, and in `openspec/specs/` when it has. The page after it SHALL show the spec change. Choosing follow-up or drop and sending feedback SHALL settle the dispute in the next round without a code change. Follow-up SHALL also file an issue for it, as for any follow-up answer.

#### Scenario: Spec edit chosen
- **WHEN** the reviewer chooses the spec edit and sends feedback
- **THEN** the next round changes the spec and the code together, in the delta before the archive passes and in `openspec/specs/` after it
- **AND** the page after it shows the spec change

#### Scenario: Follow-up chosen
- **WHEN** the reviewer chooses the follow-up and sends feedback
- **THEN** the next round files a follow-up issue for it and settles the dispute without changing code, naming the issue in the dispute's Settled line

## ADDED Requirements

### Requirement: Settled and answered items stay off later pages
A failure the round fixed, a dispute the reviewer settled, and an item the reviewer answered that needed no further work MUST NOT appear on the next page as items. A settled dispute SHALL stay in the dispute log. An item whose answer asked for no work, by keeping, leaving, dropping or following it up with no note or Other text, SHALL stay off later pages, failed steps and failed checklist rows included, until its text changes, or a failed step's problems, whatever the response said.

#### Scenario: Failure fixed
- **WHEN** the round fixes a failure that was a red item
- **THEN** the next page does not show that item

#### Scenario: Dispute settled
- **WHEN** the reviewer settled a dispute in their feedback
- **THEN** the next page does not show it as an item
- **AND** its dispute log still has the entry

#### Scenario: Answered row changes
- **WHEN** the reviewer leaves a checklist row that was not verified, and a later retest fails it
- **THEN** the next page shows the row again, as failed

#### Scenario: Kept dispute changes
- **WHEN** the reviewer keeps a dispute as it is, the round's response says it needed no change, and a later round renames the dispute
- **THEN** the next page shows the dispute again

### Requirement: A follow-up answer files an issue
When a feedback round starts, the workflow SHALL file one GitHub issue for each answer that chose a follow-up, titled with the item's title as the page showed it, with the item's text, its decision or dispute log entry and the answer's note. It SHALL record the issue's link on the saved answer, and the round's implementor SHALL name the issue in its response and in the entry's Settled line.

#### Scenario: Follow-up chosen
- **WHEN** the reviewer chooses "File a follow-up issue" on a dispute and sends feedback
- **THEN** the next round files one issue titled with the item's title, holding the dispute's log entry
- **AND** the next page's "Since round" list links to the issue

### Requirement: The follow-up option says what it does
Each follow-up option SHALL read "File a follow-up issue" and say that the next round files a GitHub issue and changes nothing in this pull request. The wording SHALL be the workflow's, whatever the ranking or the reader check wrote.

#### Scenario: The ranking words the option
- **WHEN** the ranking words a follow-up option "Define a follow-up change"
- **THEN** the page shows "File a follow-up issue" with the workflow's wording

### Requirement: A follow-up issue is filed once
An issue that cannot be filed SHALL be a red Failure item on the next page, and each later round SHALL try to file it again until it is filed or the reviewer answers that failure without asking for work. A resumed round SHALL file only the issues still missing, and SHALL find an issue it already filed instead of filing it again.

#### Scenario: Issue cannot be filed
- **WHEN** the forge refuses the issue
- **THEN** the next page has a red Failure item saying a follow-up issue could not be filed

#### Scenario: Resumed round
- **WHEN** a round is resumed after it filed its issues
- **THEN** no issue is filed twice

#### Scenario: Filed in a later round
- **WHEN** an issue cannot be filed in round 2, and the reviewer answers page 2's failure item with "Fix it in the next round"
- **THEN** round 3 files the issue

#### Scenario: Reviewer takes it on
- **WHEN** the reviewer answers the failure item with "Leave it for me to handle"
- **THEN** later rounds do not try to file that issue again
