# review-handoff Specification

## Purpose
Defines the review package the `codagent-implement-change` workflow writes into the pull request when its acceptance rounds end: the decision and dispute logs, the testing evidence summary, and the ranked "Review first" section that a script checks before it leads the description.

## Requirements

### Requirement: Every run whose acceptance rounds end writes a review package into its pull request
At the end of every run whose acceptance rounds end, converged or not, whatever failed before, the workflow SHALL write a review package into the pull request. The package SHALL surface what went wrong or needs the person's call, and collapse or leave out what went right.

#### Scenario: Run ends after a failed step
- **WHEN** acceptance, the archive or finalize failed
- **THEN** the package is still written, with each failure among its red items

#### Scenario: Package cannot be written
- **WHEN** the package cannot be written into the pull request
- **THEN** the run fails

### Requirement: A decision log records what the definition did not settle
Each agent SHALL record in the run's `decision-log.md`, as it works, each point the definition did not settle that it settled on its own and that could change behavior, scope or integration. Each entry SHALL give the step, the question, the requirement, the decision, the alternatives, the rationale, what breaks if it is wrong, and any decision pending from the user. After the acceptance rounds, a script SHALL number the entries `D-01`, `D-02` and so on and commit the log in the change folder.

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
- **WHEN** the implementor settles a question after the logs are committed, while repairing the archive's delta or fixing the pull request in finalize
- **THEN** it adds the entry to the committed decision log in the change folder, numbered after the last entry, and commits it with that work

#### Scenario: Log commit fails
- **WHEN** the commit of the logs fails
- **THEN** the run goes on, and the archive commit takes the logs along with the archive folder

### Requirement: A dispute log records what the agents left unfixed without agreement
The workflow SHALL commit `dispute-log.md` in the change folder, numbered `DP-01`, `DP-02` and so on, with one entry for each `high` or `medium` review finding still disputed or never fixed, each audit finding the implementor did not fix, and each pull request review comment the finalize fixer did not fix. Each entry SHALL give the finding or comment and both sides.

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

### Requirement: The testing evidence is summarized for the person
The workflow SHALL summarize the testing evidence: each spec behavior's verdict and evidence from the checklist, what the acceptance tester exercised and did not, text equivalents of its screenshots, the human-only checks the test plan reserves for a person, and each commit after the accepted head with the tests that cover it. Screenshots and logs SHALL stay in the run's artifacts folder, and CI results SHALL NOT be repeated.

#### Scenario: Commits follow acceptance
- **WHEN** commits were made after the accepted head, which is the last round's `READY` revision, else the last tested revision, else the head when the pull request opened
- **THEN** the evidence lists them, with their size as `git diff --shortstat` reports it and a sentence starting `Tests:` that names the tests covering them or says none do

#### Scenario: Commits touch only the change folder
- **WHEN** a commit after the accepted head changes only files under `openspec/`, such as the logs, the archive or a recorded dispute
- **THEN** it is not listed as a commit after acceptance

#### Scenario: Test plan reserves a check for a person
- **WHEN** the test plan has human-only checks
- **THEN** the evidence lists each one as left to the person

### Requirement: Every item is ranked in one tier
The reviewer, in a fresh session after finalize, SHALL rank every item from the testing evidence, the decision log and the dispute log into exactly one of red, orange, yellow and white, by the Agent Factory's tier rules without their Agent Validator, task-compliance, resume and plan-revision parts. Items that share one root cause SHALL become one item, in the highest tier any of them reaches, listing each symptom.

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
- **WHEN** a checklist row is not verified and names an automated test that covers it
- **THEN** the item is red, not yellow, because no run records that test passing at the final head

#### Scenario: Unfixed comment is a style preference
- **WHEN** the finalize fixer did not fix a pull request comment that asked only for a style preference
- **THEN** the ranking agent may put it in yellow, where it shows collapsed with its Dispute type

#### Scenario: White items
- **WHEN** a spec behavior passed with evidence
- **THEN** the item is white

#### Scenario: Symptoms share a cause
- **WHEN** a failed behavior and a disputed finding come from the same defect
- **THEN** they are one red item that lists both

### Requirement: Each item has a type
Each ranked item SHALL have a type: Verification for a spec behavior's result, Decision for a decision-log entry, Dispute for a dispute-log entry, Late commit for the commits after the accepted head, or Human check for a check the test plan leaves to the person. A merged item SHALL list each type it covers.

#### Scenario: Item merges two kinds
- **WHEN** a failed behavior and a dispute become one item
- **THEN** its type is `Verification, Dispute`

### Requirement: Each failed step is a red item
The workflow SHALL add a red item of type Failure for each failed acceptance, archive or finalize from the run's own results, saying what failed and what is left to do.

#### Scenario: Finalize failed
- **WHEN** finalize failed because a check on the final head failed
- **THEN** a red item names the check and says the merge is blocked until it passes

#### Scenario: Acceptance fix was blocked
- **WHEN** an acceptance fix reported itself blocked on a decision only the user can make
- **THEN** a red item says acceptance stopped on that decision and names its decision-log entry

#### Scenario: Acceptance push failed
- **WHEN** an acceptance round's push still failed after its repair
- **THEN** a red item says the push failed and that the pull request lacks the round's fix unless finalize pushed it

### Requirement: A script checks the ranking
A script SHALL build its own list of required items from files the ranking agent does not write, and SHALL reject a ranking that leaves one out or ranks it lower than its tier: the checklist's failed and unverified rows and each failed step must be red, and each dispute-log entry other than a pull request comment, and the commits after the accepted head, must be at least orange.

#### Scenario: Ranking leaves out a required item
- **WHEN** the ranking omits a failed checklist row
- **THEN** the check rejects it, naming the row, and the ranking agent repairs the ranking once

#### Scenario: Ranking is still wrong after its repair
- **WHEN** the repaired ranking still fails the check
- **THEN** the script places each required item in its tier itself, and the package is written

#### Scenario: Ranking agent's judgment
- **WHEN** an item is not on the required list, such as a pull request comment the finalize fixer did not fix
- **THEN** the check accepts the tier the ranking agent gave it

### Requirement: "Review first" leads the pull request description
The workflow SHALL write a "Review first" section at the top of the generated part of the pull request description, between the generated-body markers, followed by the change summary and then the collapsed sections.

#### Scenario: Section content
- **WHEN** the package is written
- **THEN** "Review first" gives the run's state as succeeded or needs attention, followed by how many red items block the merge when there are any, every red item, then up to five orange items with the commits after acceptance first, and a line counting the orange and yellow items collapsed below

#### Scenario: Red items under a succeeded run
- **WHEN** every step passed and the ranking has one red item
- **THEN** "Review first" reads "Run succeeded. 1 red item blocks the merge."

#### Scenario: Item prefix
- **WHEN** an item is shown
- **THEN** it starts with its type, such as `Dispute:` or `Verification, Dispute:` for a merged item

#### Scenario: Collapsed sections
- **WHEN** the package is written
- **THEN** below the change summary, the remaining orange and yellow items, the testing evidence with the white items, the decision log and the dispute log each appear in a collapsed section

### Requirement: Items link to where they show
Each item SHALL link to where it shows: a committed file with the line or range that shows it, or a URL.

#### Scenario: Item cites a committed file
- **WHEN** an item's evidence is a line range in a committed file
- **THEN** the item links to that file and range

#### Scenario: Item cites a run file
- **WHEN** an item's evidence is a file in the run's artifacts folder
- **THEN** the item names the path as plain text
