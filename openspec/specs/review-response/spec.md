# review-response Specification

## Purpose
TBD - created by archiving change add-review-page. Update Purpose after archive.

## Requirements

### Requirement: The run waits for the reviewer
When the wait is on, the run SHALL pause after publishing the review package, at a wait that the review page, the Archon CLI or the Archon UI can answer. The wait MUST have no time limit, and the run keeps its worktree while it waits. When the wait is off, the run SHALL end after publishing, as it does without this change.

#### Scenario: Wait on
- **WHEN** the run publishes its package with the wait on
- **THEN** the run pauses until the reviewer sends feedback or merges

#### Scenario: Wait off
- **WHEN** the run publishes its package with the wait off
- **THEN** the run ends without waiting

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

### Requirement: Only the current round's answer counts
The run SHALL act on an answer only when it carries the run's current round. An answer from an earlier round's page, or an empty answer such as a bare resume gives, MUST start nothing, and the run goes on waiting.

#### Scenario: Answer from an earlier page
- **WHEN** the run is waiting after round 2 and receives an answer that carries round 1
- **THEN** the run starts no round and does not merge
- **AND** goes on waiting

#### Scenario: Empty answer
- **WHEN** the run is waiting after round 2 and is resumed without an answer
- **THEN** the run starts no round, writes nothing, and waits at round 2's page again

### Requirement: A feedback round first merges in the base branch
Each feedback round SHALL start by merging in the latest tip of the base branch, and the pull request branch's remote tip when it moved, and resolving any conflicts. Each decision the merge needs SHALL be recorded in the decision log and ranked like any other agent decision. A conflict the round cannot resolve without a person SHALL be a red item on the next page. Code review SHALL cover the conflict resolutions with the rest of the round's changes.

#### Scenario: Base branch moved
- **WHEN** the base branch gained commits while the run waited
- **THEN** the round merges them into the pull request branch before addressing the feedback

#### Scenario: Conflict resolved with a judgment call
- **WHEN** resolving a conflict means choosing between the two sides' behavior
- **THEN** the decision log has an entry for the choice
- **AND** the next page ranks it with the other decisions

#### Scenario: Conflict needs a person
- **WHEN** the round cannot resolve a conflict without a person
- **THEN** the next page has a red item for the conflict

#### Scenario: Someone pushed to the branch
- **WHEN** the pull request branch's remote tip moved while the run waited
- **THEN** the round merges it in, without a force push

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

### Requirement: The next page reflects the round
The next page's Description section SHALL open with a "Since round <n>" list of what happened since that round's page, in plain words without decision or dispute codes, each entry in the past tense: the answers whose work was done, the follow-up issues filed, the branch's other commits since that page, the base merge and the retest. An answer that needed no work SHALL NOT be listed.

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

### Requirement: The late commit item lists the journeys its commits could affect
When commits follow the accepted head, including a feedback round's fixes and conflict resolutions, the page's Late commit item SHALL also list each acceptance journey those commits could affect, with its code, its title and the commit that touches it. The journeys SHALL be ones an acceptance round recorded exercising. When it lists a journey, it SHALL offer "Retest".

#### Scenario: Journeys affected
- **WHEN** a round's fix changes behavior that two journeys exercise
- **THEN** the next page's Late commit item lists both journeys, each with its code, title and the commit that touches it, and offers "Retest"

#### Scenario: No journey affected
- **WHEN** the commits after the accepted head affect no acceptance journey
- **THEN** the Late commit item lists no journeys and offers no "Retest"

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

### Requirement: Settled and answered items stay off later pages
A failure the round fixed, a dispute the reviewer settled, and an item the reviewer answered that needed no further work MUST NOT appear on the next page as items. A settled dispute SHALL stay in the dispute log. An item whose answer asked for no work, by keeping, leaving, dropping or following it up with no note or Other text, SHALL stay off later pages, failed steps and failed checklist rows included, until its text changes or, for a failed step, the problems behind it.

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
The implementor MUST NOT make a change that would alter approved behavior. It SHALL log a dispute, and the next page SHALL show it as an item, orange unless its gap should block the merge, with three options: a specific spec edit the page spells out, filing a follow-up issue, or dropping it. A request that needs a new capability or a large revision SHALL get only the follow-up and drop options.

#### Scenario: Feedback would change approved behavior
- **WHEN** an answer asks for behavior the specs rule out
- **THEN** the implementor does not make the change and logs a dispute
- **AND** the next page shows it as an orange item with the spec edit, follow-up and drop options

#### Scenario: Large request
- **WHEN** the request would need a new capability or a large revision
- **THEN** the item offers only the follow-up and drop options

### Requirement: The reviewer's choice on a spec change is carried out
Choosing the spec edit SHALL make the next round change the spec and the code together: in the change's delta when the archive has not passed, and in `openspec/specs/` when it has. The page after it SHALL show the spec change. Choosing follow-up or drop and sending feedback SHALL settle the dispute in the next round without a code change. Follow-up SHALL also file an issue for it, as for any follow-up answer.

#### Scenario: Spec edit chosen
- **WHEN** the reviewer chooses the spec edit and sends feedback
- **THEN** the next round changes the spec and the code together, in the delta before the archive passes and in `openspec/specs/` after it
- **AND** the page after it shows the spec change

#### Scenario: Follow-up chosen
- **WHEN** the reviewer chooses the follow-up and sends feedback
- **THEN** the next round files a follow-up issue for it and settles the dispute without changing code, naming the issue in the dispute's Settled line

### Requirement: Merge
On a merge answer, the run SHALL merge the pull request at the head the page showed, and end. It MUST NOT merge while the round's archive or finalize has failed, whatever the answer came from; it SHALL ask again, saying why.

#### Scenario: Merge accepted
- **WHEN** the reviewer merges from a page that shows the branch's current head
- **THEN** the pull request is merged at that head and the run ends

#### Scenario: A failure hides Merge
- **WHEN** a plain-text `merge` arrives while the round's finalize has failed
- **THEN** the run does not merge, and asks again, saying finalize failed

### Requirement: The run handles each merge outcome
When the forge refuses the merge for the repository's rules, the run SHALL ask again with the forge's reason, without a round. When the forge cannot say whether the merge happened, the run SHALL read the pull request back and act on what it finds. When the pull request was merged or closed outside the run, the next answer SHALL end the run: as merged when it was merged, and as failed when it was closed.

#### Scenario: Repository rules refuse the merge
- **WHEN** the forge refuses the merge because the repository requires an approval
- **THEN** the run asks again with the forge's reason and starts no round

#### Scenario: Merge result unclear
- **WHEN** the forge cannot say whether the merge happened
- **THEN** the run reads the pull request back, and ends as merged when it was merged, or asks again when it was not

#### Scenario: Merged outside the run
- **WHEN** the person merged the pull request on the forge and then answers the wait
- **THEN** the run ends as merged

#### Scenario: Closed outside the run
- **WHEN** the pull request was closed on the forge and the person answers the wait
- **THEN** the run ends as failed, naming the closed pull request

### Requirement: A refused merge runs another round
When the forge refuses the merge, because the branch moved or no longer merges cleanly, the run SHALL run a round with no feedback: it merges in the base branch, resolves conflicts, finalizes, writes a new page that says why the merge was refused, and waits again.

#### Scenario: Branch no longer merges
- **WHEN** the base branch changed after the page was written and the merge is refused for a conflict
- **THEN** the run merges in the base branch, resolves the conflict, finalizes and writes a new page
- **AND** the new page says why the merge was refused

#### Scenario: Head moved
- **WHEN** someone pushed to the branch after the page was written
- **THEN** the merge is refused, and the run brings the push in and writes a new page

### Requirement: A resumed run continues its review round
When a run that failed during a review round is resumed, it SHALL continue that round from the answers already saved. Resuming MUST NOT write over an earlier round's page or answers.

#### Scenario: Failed round resumed
- **WHEN** an agent in round 2 fails outright and the run is resumed
- **THEN** the run runs round 2 again from round 1's saved answers
- **AND** round 1's page and answers are unchanged

### Requirement: The latest page can be found
The `implement-change` skill in `human-workflows/archon/` SHALL give the person the review page's address when the run waits, and SHALL, given a change name or a pull request, find the run and give its latest page's address.

#### Scenario: Run waits
- **WHEN** a run the skill started publishes its package and waits
- **THEN** the skill gives the person the latest page's address

#### Scenario: Lookup by change or pull request
- **WHEN** the person asks the skill for the review page of a change name or a pull request
- **THEN** the skill finds that change's run and gives its latest page's address

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
An issue that cannot be filed SHALL be a red Failure item on the next page. A resumed round SHALL file only the issues still missing, and SHALL find an issue it already filed instead of filing it again.

#### Scenario: Issue cannot be filed
- **WHEN** the forge refuses the issue
- **THEN** the next page has a red Failure item saying a follow-up issue could not be filed

#### Scenario: Resumed round
- **WHEN** a round is resumed after it filed its issues
- **THEN** no issue is filed twice
