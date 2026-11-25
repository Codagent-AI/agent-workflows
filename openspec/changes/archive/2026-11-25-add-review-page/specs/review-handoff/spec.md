## RENAMED Requirements

- FROM: `### Requirement: Every run whose acceptance rounds end writes a review package into its pull request`
- TO: `### Requirement: Every run whose acceptance rounds end writes a review page`
- FROM: `### Requirement: The testing evidence is summarized for the person`
- TO: `### Requirement: The testing evidence is gathered for the ranking`

## MODIFIED Requirements

### Requirement: Every run whose acceptance rounds end writes a review page
At the end of every run whose acceptance rounds end, converged or not, whatever failed before, and at the end of every feedback round, the workflow SHALL write the review package as that round's review page, unless `stop_after` is `acceptance`. The package SHALL surface what went wrong or needs the person's call, and leave out what went right apart from the key evidence.

#### Scenario: Run ends after a failed step
- **WHEN** acceptance, the archive or finalize failed
- **THEN** the package is still written, with each failure among its red items

#### Scenario: Feedback round ends
- **WHEN** a feedback round finishes its publish
- **THEN** the package is written as that round's page

#### Scenario: Package cannot be written
- **WHEN** the review page cannot be written
- **THEN** the run fails

### Requirement: A decision log records what the definition did not settle
Each agent SHALL record in the run's `decision-log.md`, as it works, each point the definition did not settle that it settled on its own and that could change behavior, scope or integration. Each entry SHALL give the step, the question, the requirement, the decision, the alternatives, the rationale and what breaks if it is wrong. After the acceptance rounds, a script SHALL number the entries `DECIDE-1`, `DECIDE-2` and so on and commit the log in the change folder.

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
The workflow SHALL gather the testing evidence for the ranking: each spec behavior's verdict and evidence from the checklist, what the acceptance tester exercised and did not, text equivalents of its screenshots, the human-only checks the test plan reserves for a person, and each commit after the accepted head with the tests that cover it. Screenshots and logs SHALL stay in the run's artifacts folder. The page MUST NOT show the testing evidence as a section, and CI results SHALL NOT be repeated.

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

#### Scenario: Evidence is not a section
- **WHEN** the page is written
- **THEN** it has no testing evidence section

### Requirement: Every item is ranked in one tier
The reviewer, in a fresh session after finalize, SHALL rank every item from the testing evidence, the decision log and the dispute log into exactly one of red, orange, yellow and white, by the Agent Factory's tier rules without their Agent Validator, task-compliance, resume and plan-revision parts. Items that share one root cause SHALL become one item, in the highest tier any of them reaches, listing each symptom. When finalize passed CI, a checklist row that is not verified but names an automated test a CI suite runs SHALL count as verified by that test.

#### Scenario: Red items
- **WHEN** a spec behavior failed, a checklist row is failed or not verified, or a decision departs from the definition
- **THEN** the item is red

#### Scenario: Orange items
- **WHEN** a decision changes scope, weakens a guarantee, affects other callers or is costly to reverse, a high or medium review finding was declined, is disputed or was never fixed, an audit finding was not fixed, a pull request comment was not fixed and leaving it could change behavior or weaken a guarantee, or commits follow the accepted head
- **THEN** the item is orange, unless a red rule also applies

#### Scenario: Yellow items
- **WHEN** acceptance did not exercise a behavior whose checklist row a passing automated test verifies, or a decision or dispute meets no red or orange rule
- **THEN** the item is yellow, naming the test where one covers it

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
- **WHEN** a spec behavior passed with evidence
- **THEN** the item is white

#### Scenario: Symptoms share a cause
- **WHEN** a failed behavior and a disputed finding come from the same defect
- **THEN** they are one red item that lists both

### Requirement: Each item has a type
Each ranked item SHALL have a type: Risk for a spec behavior that is not verified, Failure for one that failed or for a failed step, Verification for one that passed, Agent decision for a decision-log entry, Dispute for a dispute-log entry, Late commit for the commits after the accepted head, or Human check for a check the test plan leaves to the person. A merged item SHALL list each type it covers.

#### Scenario: Item merges two kinds
- **WHEN** a failed behavior and a dispute become one item
- **THEN** its type is `Failure, Dispute`

#### Scenario: Behavior not verified
- **WHEN** acceptance did not exercise a behavior and no evidence verifies it
- **THEN** its item's type is Risk

### Requirement: Each failed step is a red item
The workflow SHALL add a red item of type Failure for each failed acceptance, retest, archive or finalize from the run's own results, and, in a feedback round, for a failed base merge, a blocked `address-feedback`, a response file the check rejected, a failed push and a failed description update, saying what failed and what is left to do, and ending with the standard question: "Fix it in the next round" (recommended) or "Leave it for me to handle", then "Other".

#### Scenario: Finalize failed
- **WHEN** finalize failed because a check on the final head failed
- **THEN** a red item names the check and says the merge is blocked until it passes

#### Scenario: Acceptance fix was blocked
- **WHEN** an acceptance fix reported itself blocked on a decision only the user can make
- **THEN** a red item says acceptance stopped on that decision and names its decision-log entry

#### Scenario: Acceptance push failed
- **WHEN** an acceptance round's push still failed after its repair
- **THEN** a red item says the push failed and that the pull request lacks the round's fix unless finalize pushed it

#### Scenario: Standard question
- **WHEN** the workflow writes a failed step's item
- **THEN** the item ends with the standard question, with "Fix it in the next round" recommended

#### Scenario: Push failed in a feedback round
- **WHEN** a feedback round's push still fails after its repair
- **THEN** the round's page has a red item for the push

### Requirement: A script checks the ranking
A script SHALL build its own list of required items from files the ranking agent does not write, and SHALL reject a ranking that leaves one out or ranks it lower than its tier: the checklist's failed and unverified rows, each failed step and each dispute that needs a spec change must be red; an unverified row that names an existing test when finalize passed with checks must be at least yellow; and each other dispute-log entry other than a pull request comment, and the commits after the accepted head, must be at least orange.

#### Scenario: Ranking leaves out a required item
- **WHEN** the ranking omits a failed checklist row
- **THEN** the check rejects it, naming the row, and the ranking agent repairs the ranking once

#### Scenario: Ranking is still wrong after its repair
- **WHEN** the repaired ranking still fails the check
- **THEN** the script keeps every valid item the ranking agent gave, places each missing or underranked required item in its tier itself, and the package is written

#### Scenario: Ranking agent's judgment
- **WHEN** an item is not on the required list, such as a pull request comment the finalize fixer did not fix
- **THEN** the check accepts the tier the ranking agent gave it

### Requirement: Items link to where they show
Each item SHALL link to where it shows: a committed file with the line or range that shows it, a file in the run's artifacts folder, or a URL.

#### Scenario: Item cites a committed file
- **WHEN** an item's evidence is a line range in a committed file
- **THEN** the item links to that file and range

#### Scenario: Item cites a run file
- **WHEN** an item's evidence is a file in the run's artifacts folder
- **THEN** the item links to it by its path relative to the page

## REMOVED Requirements

### Requirement: "Review first" leads the pull request description
**Reason**: The package moves out of the pull request description into the review page.
**Migration**: The page's order is in the `review-page` capability, its state line is in "The page's state line" below, and the description's content is in `draft-pull-request`.

## ADDED Requirements

### Requirement: The page's state line
The page SHALL give the run's state as succeeded or needs attention, name the archive or finalize failure that hides Merge when there is one, and say how many red items need the reviewer's call. It MUST NOT say that red items block the merge.

#### Scenario: Red items under a succeeded run
- **WHEN** every step passed and the ranking has one red item
- **THEN** the state line says the run succeeded and that 1 red item needs the reviewer's call

#### Scenario: Finalize failed
- **WHEN** finalize failed and the page has three red items
- **THEN** the state line says the run needs attention, that Merge is hidden because finalize failed, and that 3 red items need the reviewer's call

### Requirement: The ranking asks a question on each item that needs one
The ranking agent SHALL end each red, orange and yellow item with one or more questions, each with two to four options, the recommended one first. White items MUST NOT have questions.

#### Scenario: Yellow decision
- **WHEN** the ranking puts an agent decision in yellow
- **THEN** the item ends with a question whose first option is the recommended one

### Requirement: The ranking picks the key evidence
The ranking agent SHALL pick up to five of the run's acceptance screenshots as key evidence, each with a title and a line on what it shows. When the run has no screenshots, it SHALL pick none.

#### Scenario: Screenshots picked
- **WHEN** the run has twenty acceptance screenshots
- **THEN** the ranking names up to five of them, each with a title and a line on what it shows

#### Scenario: No screenshots
- **WHEN** the run has no acceptance screenshots
- **THEN** the ranking picks no key evidence

### Requirement: The check covers questions and key evidence
The script SHALL also reject a ranking with a red, orange or yellow item without a question, a question without two to four options, or key evidence that names a screenshot the run does not have, names more than five, or names none when the run has screenshots. It SHALL also reject a Late commit journey that no acceptance round recorded, unless the test plan lists it as an `AT-` case, and a dispute that needs a spec change whose question does not offer the follow-up and drop options.

#### Scenario: Item without a question
- **WHEN** an orange item has no question
- **THEN** the check rejects the ranking, naming the item

#### Scenario: Unknown screenshot
- **WHEN** the key evidence names a screenshot that is not in the run's artifacts folder
- **THEN** the check rejects the ranking, naming the screenshot

#### Scenario: Unknown journey
- **WHEN** the Late commit item lists a journey code that no acceptance round recorded
- **THEN** the check rejects the ranking, naming the code

### Requirement: The fallback keeps the agent's valid questions and picks
When the script places items itself, it SHALL give the standard question to each red, orange or yellow item without a valid one, and to a dispute that needs a spec change the spec edit its entry records, the follow-up and the drop options, or only the last two when it records no edit, keep the key evidence that names the run's screenshots, at most five, and drop the rest. When no pick is valid, the page SHALL have no key evidence section, and every screenshot SHALL still show.

#### Scenario: Item placed by the script
- **WHEN** the script places a required item the ranking left out
- **THEN** the item ends with the standard question

#### Scenario: Spec-change dispute placed by the script
- **WHEN** the script places a dispute that needs a spec change and its entry records an edit
- **THEN** the item is red, and its question offers that edit, merging with a follow-up change, and dropping it

#### Scenario: Some picks invalid
- **WHEN** the repaired ranking still names two real screenshots and one that does not exist
- **THEN** the page's key evidence shows the two real screenshots

#### Scenario: No valid pick
- **WHEN** none of the ranking's key evidence names a real screenshot
- **THEN** the page has no key evidence section
- **AND** every screenshot still shows
