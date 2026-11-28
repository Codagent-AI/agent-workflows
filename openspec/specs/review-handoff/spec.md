# review-handoff Specification

## Purpose
Defines the review package the `codagent-implement-change` workflow writes into the pull request when its acceptance rounds end: the decision and dispute logs, the testing evidence summary, and the ranked "Review first" section that a script checks before it leads the description.

## Requirements

### Requirement: Every run whose acceptance rounds end writes a review page
At the end of every run whose acceptance rounds end, converged or not, whatever failed before other than a push, and at the end of every feedback round, the workflow SHALL write the review package as that round's review page, unless `stop_after` is `acceptance`. The package SHALL surface what went wrong or needs the person's call, and leave out what went right apart from the key evidence. The workflow MUST NOT write a page for a head that is not the pull request's head on GitHub; the run SHALL fail instead.

#### Scenario: Run ends after a failed step
- **WHEN** acceptance, the archive or finalize failed, other than by a push
- **THEN** the package is still written, with each failure among its red items

#### Scenario: Push still fails
- **WHEN** a push still fails after its repair
- **THEN** the run fails and no page is written for it

#### Scenario: Head is not on GitHub
- **WHEN** the head the page would show is not the pull request's head on GitHub
- **THEN** no page is written and the run fails, saying the head is not on GitHub

#### Scenario: Feedback round ends
- **WHEN** a feedback round finishes its publish
- **THEN** the package is written as that round's page

#### Scenario: Package cannot be written
- **WHEN** the review page cannot be written
- **THEN** the run fails

### Requirement: A decision log records what the definition did not settle
Each agent SHALL record in the run's `decision-log.md`, as it works, each point the definition did not settle that it settled on its own and that could change behavior, scope or integration. Each entry SHALL give the step, the question, the requirement, the decision, the alternatives, the rationale and what breaks if it is wrong. After the acceptance rounds, a script SHALL number the entries `DECIDE-1`, `DECIDE-2` and so on and commit the log in the change folder. Entries the run's log gains in a later round SHALL be added to the committed log in that round, numbered after its last entry. An entry that only records the reviewer's answer SHALL be marked `Settled in review round <n>`.

#### Scenario: Agent settles an open or ambiguous point
- **WHEN** the implementor, the auditor or the tester makes a choice the definition left open, reads an ambiguous or conflicting requirement one way, finds a planned check cannot work, judges a reproduced violation not to be one, or makes an assumption where a spec was unclear
- **THEN** the decision log has an entry for it

#### Scenario: Agents agree not to fix a defect
- **WHEN** the implementor declines to fix a `high` or `medium` review finding and the reviewer accepts the decline
- **THEN** a script adds an entry to the decision log with the finding and the reason

#### Scenario: Work went as expected
- **WHEN** the reviewer confirms a fix, the audit finds nothing, or a check passes
- **THEN** the decision log has no entry for it

#### Scenario: Logs are committed before the archive
- **WHEN** the acceptance rounds end, converged or not
- **THEN** a script numbers the entries of both logs and commits them in the change folder before the archive runs, so the archive moves them to the change's archive folder and finalize's CI covers the commit

#### Scenario: Decision after the logs are committed
- **WHEN** the implementor settles a question after the logs are committed, while repairing the archive's delta, fixing the pull request in finalize, or working in a feedback round, including merging in the base branch
- **THEN** it adds the entry to the committed decision log in the change folder, numbered after the last entry, and commits it with that work

#### Scenario: Tester decides in a retest
- **WHEN** the tester records a decision in the run's log during a feedback round's retest
- **THEN** the entry is added to the committed decision log in that round, numbered after the last entry, before the ranking runs

#### Scenario: Entry records the reviewer's answer
- **WHEN** an agent records in the decision log a choice the reviewer made on a page
- **THEN** the entry is marked `Settled in review round <n>`

#### Scenario: No pending decision field
- **WHEN** an entry is written
- **THEN** it has no field for a decision pending from the user

#### Scenario: Log commit fails
- **WHEN** the commit of the logs fails
- **THEN** the run goes on, and the archive commit takes the logs along with the archive folder

### Requirement: A dispute log records what the agents left unfixed without agreement
The workflow SHALL commit `dispute-log.md` in the change folder, numbered `DISPUTE-1`, `DISPUTE-2` and so on, with one entry for each `high` or `medium` review finding still disputed or never fixed, each audit finding the implementor did not fix, and each pull request review comment the finalize fixer did not fix. Each entry SHALL give the finding or comment and both sides.

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

### Requirement: The testing evidence is gathered for the ranking
The workflow SHALL gather the testing evidence for the ranking: each spec behavior's verdict and evidence from the checklist, what the acceptance tester exercised and did not, text equivalents of its screenshots, its command evidence, the human-only checks the test plan reserves for a person, and each commit after the accepted head with the tests that cover it. Screenshots and logs SHALL stay in the run's artifacts folder. The page MUST NOT show the testing evidence as a section, and CI results SHALL NOT be repeated.

#### Scenario: Commits follow acceptance
- **WHEN** commits were made after the accepted head, which is the last acceptance round's `READY` revision, else its last tested revision, else the head when the pull request opened, as saved when the acceptance rounds end; a retest does not change it
- **THEN** the evidence lists them, with their size as `git diff --shortstat` reports it and a sentence starting `Tests:` that names the tests covering them or says none do

#### Scenario: Commits touch only the change folder
- **WHEN** a commit after the accepted head changes only files under `openspec/`, such as the logs, the archive or a recorded dispute
- **THEN** it is not listed as a commit after acceptance

#### Scenario: Base branch merged in
- **WHEN** a commit after the accepted head merges in the base branch
- **THEN** the evidence lists only its conflict resolutions, and does not list it when it resolved none
- **AND** the base branch's own commits are not listed

#### Scenario: Test plan reserves a check for a person
- **WHEN** the test plan has human-only checks
- **THEN** the evidence lists each one as left to the person

#### Scenario: Command evidence
- **WHEN** the tester recorded command evidence in an acceptance round
- **THEN** the evidence lists each entry with its title, what it shows, its command and its excerpt

#### Scenario: Evidence is not a section
- **WHEN** the page is written
- **THEN** it has no testing evidence section

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

### Requirement: Each item has a type
Each ranked item SHALL have a type: Risk for a spec behavior that is not verified, Failure for one that failed or for a failed step, Agent decision for a decision-log entry, Dispute for a dispute-log entry, Late commit for the commits after the accepted head, or Human check for a check the test plan leaves to the person. A merged item SHALL list each type it covers.

#### Scenario: Item merges two kinds
- **WHEN** a failed behavior and a dispute become one item
- **THEN** its type is `Failure, Dispute`

#### Scenario: Behavior not verified
- **WHEN** acceptance did not exercise a behavior and no evidence verifies it
- **THEN** its item's type is Risk

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

### Requirement: A script checks the ranking
A script SHALL build its own list of required items from files the ranking agent does not write, and SHALL reject a ranking that leaves one out or ranks it lower than its tier:
- the checklist's failed and unverified rows and each failed step must be red;
- an unverified row that names an existing test when finalize passed with checks must be at least yellow;
- each other open dispute-log entry other than a pull request comment, spec-change disputes included, and the commits after the accepted head, must be at least orange;
- each open decision-log entry and each open pull request comment dispute must be at least yellow.

A decision-log or dispute-log entry SHALL be open unless it is marked settled or an earlier round's response record marks it fixed, unchanged or settled. A response to a question that an item's entries share SHALL settle every entry that shares it. An entry with a question of its own SHALL be settled only by the response to that entry. An item whose latest answer asked for no work SHALL NOT be required until it changes.

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

### Requirement: Items link to where they show
Each item SHALL end with one or more labeled links to where it shows, on GitHub at the head the page shows: a committed file with the line or range that shows it, an entry in the committed decision or dispute log, or a commit. The ranking agent SHALL name each target and its label, and the publisher SHALL build the link. An item for a failed step MAY have no link when what shows it is only in the run's files. An item MUST NOT link to a file in the run's artifacts folder or to a local path.

#### Scenario: Item cites a committed file
- **WHEN** an item's evidence is a line range in a committed file
- **THEN** the item links to that file and range on GitHub at the page's head

#### Scenario: Item cites a log entry
- **WHEN** an item is about a decision-log entry
- **THEN** it has a labeled link, such as "How the agent decided", to that entry in the committed log on GitHub

#### Scenario: Item cites a commit
- **WHEN** an item covers a commit after the accepted head
- **THEN** it links to that commit on GitHub

#### Scenario: Item cites a run file
- **WHEN** what shows an item is only in the run's artifacts folder, such as the tester's report
- **THEN** the item has no link to it and says in its own words what matters from it

#### Scenario: Failed step shown only in run files
- **WHEN** a failed step's item has nothing committed that shows it, such as bad acceptance evidence or a rejected response file
- **THEN** the item has no links, and the check accepts it

#### Scenario: Other item without links
- **WHEN** an item that is not a failed step's item has no links
- **THEN** the check rejects the ranking, naming the item

### Requirement: The run's state line
The pull request description SHALL give the run's state as succeeded or needs attention, name the archive or finalize failure that hides Merge when there is one, and say how many red items need the reviewer's call. It MUST NOT say that red items block the merge. The review page SHALL NOT show the run's state.

#### Scenario: Red items under a succeeded run
- **WHEN** every step passed and the ranking has one red item
- **THEN** the state line says the run succeeded and that 1 red item needs the reviewer's call

#### Scenario: Finalize failed
- **WHEN** finalize failed and the page has three red items
- **THEN** the state line says the run needs attention, that Merge is hidden because finalize failed, and that 3 red items need the reviewer's call

#### Scenario: Page has no state line
- **WHEN** a review page is written
- **THEN** the run's state is in the pull request description and not on the page

### Requirement: The ranking asks a question on each item that needs one
The ranking agent SHALL end each item with one or more questions, each with two to four options, the recommended one first. Each question SHALL ask what the reviewer wants for the product or the pull request, not about the agents' process, and each option SHALL say in one line what choosing it does.

#### Scenario: Yellow decision
- **WHEN** the ranking puts an agent decision in yellow
- **THEN** the item ends with a question whose first option is the recommended one

#### Scenario: Option says what it does
- **WHEN** an option starts a follow-up change
- **THEN** its line says what the follow-up will cover

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

### Requirement: The check covers questions and key evidence
The script SHALL also reject a ranking with:
- an item without a question, or a question without two to four options;
- key evidence that names a screenshot or command evidence entry the run does not have, names more than five, or names none when the run has either;
- an item that names a command evidence entry the run does not have;
- a link whose target is not a file committed at the head, an entry in the committed logs or a commit in the pull request;
- a Late commit item that does not link each commit it covers;
- a Late commit journey that no acceptance round recorded, unless the test plan lists it as an `AT-` case;
- a dispute that needs a spec change whose question does not offer the follow-up and drop options.

#### Scenario: Item without a question
- **WHEN** an orange item has no question
- **THEN** the check rejects the ranking, naming the item

#### Scenario: Unknown screenshot
- **WHEN** the key evidence names a screenshot that is not in the run's artifacts folder
- **THEN** the check rejects the ranking, naming the screenshot

#### Scenario: Unknown command evidence
- **WHEN** the key evidence names a command evidence entry that no round's manifest has
- **THEN** the check rejects the ranking, naming the entry

#### Scenario: Link to a run file
- **WHEN** an item links to a file in the run's artifacts folder
- **THEN** the check rejects the ranking, naming the item

#### Scenario: Unknown journey
- **WHEN** the Late commit item lists a journey code that no acceptance round recorded
- **THEN** the check rejects the ranking, naming the code

### Requirement: The fallback keeps the agent's valid questions and picks
When the script places items itself, it SHALL write each one plainly: a title from the entry's heading or the behavior it covers, without its code, a one-line body saying what is open, and a labeled link to its source, never a code, a file path or a whole log entry in the text. It SHALL give the standard question to each item without a valid one, and to a dispute that needs a spec change the spec edit its entry records, the follow-up and the drop options, or only the last two when it records no edit. It SHALL keep the key evidence that names the run's screenshots or command evidence, at most five, and drop the rest. When no pick is valid, the page SHALL have no key evidence section, and all evidence SHALL still show.

#### Scenario: Item placed by the script
- **WHEN** the script places a required item the ranking left out
- **THEN** the item ends with the standard question

#### Scenario: Decision placed by the script
- **WHEN** the script places a decision-log entry headed `DECIDE-5: Fixture cleanup uses a temporary folder`
- **THEN** the item's title is "Fixture cleanup uses a temporary folder", its text has no `DECIDE-5`, and it links to the entry on GitHub

#### Scenario: Spec-change dispute placed by the script
- **WHEN** the script places a dispute that needs a spec change and its entry records an edit
- **THEN** the item is red, and its question offers that edit, merging with a follow-up change, and dropping it

#### Scenario: Some picks invalid
- **WHEN** the repaired ranking still names two real screenshots and one that does not exist
- **THEN** the page's key evidence shows the two real screenshots

#### Scenario: No valid pick
- **WHEN** none of the ranking's key evidence names real evidence
- **THEN** the page has no key evidence section
- **AND** all evidence still shows

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

### Requirement: Item text has no codes or paths
An item's title and body MUST NOT contain decision codes, checklist codes, source file paths, line numbers or the agents' history; those belong in the item's links. A file the product's user deals with, such as a config file, MAY be named.

#### Scenario: Codes and paths left to the links
- **WHEN** an item is about a decision-log entry and a line of source code
- **THEN** its text names neither the entry's code nor the file and line
- **AND** both are labeled links at its end

#### Scenario: Product file named
- **WHEN** a behavior depends on a config file the user writes
- **THEN** the item may name that file

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
