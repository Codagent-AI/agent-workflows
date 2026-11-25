# review-page Specification

## Purpose
TBD - created by archiving change add-review-page. Update Purpose after archive.

## Requirements

### Requirement: The page looks like the reference mockup
The page SHALL take its look and layout from the reference mockup kept with the `add-review-page` change, `mockup/review-page.html` in the change's folder, wherever these specs do not say otherwise. The mockup's content and screenshots are samples, and its sending is a stand-in.

#### Scenario: Styling not set by a spec
- **WHEN** the specs do not say how a part of the page looks or where it goes
- **THEN** the page shows it the way the reference mockup does

#### Scenario: Spec and mockup differ
- **WHEN** a spec says how the page behaves and the mockup behaves otherwise
- **THEN** the page follows the spec

### Requirement: A page for each review round
The pack SHALL write a review page to the run's artifacts folder each time it publishes the review package. Each review round's page MUST be its own file and show its round. A later round MUST NOT change an earlier round's page, except to record what was sent from it. The latest round's page SHALL also be at one fixed address for the run, so one link always opens the latest page.

#### Scenario: First publish writes a page
- **WHEN** a run publishes its review package for the first time
- **THEN** the run's artifacts folder holds a review page for round 1

#### Scenario: A feedback round writes a new page
- **WHEN** a feedback round publishes the package again
- **THEN** the artifacts folder holds a new page that shows that round
- **AND** the earlier rounds' pages are unchanged

#### Scenario: Fixed address opens the latest page
- **WHEN** a run has written pages for rounds 1 and 2
- **THEN** the run's fixed page address opens the round 2 page

### Requirement: Size of the change
Under the change summary, the page SHALL show a cloc count of the pull request against its base branch: by language, the files changed and the code lines added, modified and removed, with a total. Blank lines, comments and lock files MUST NOT be counted. When the count cannot be made, the page SHALL say so in its place and the package is still published.

#### Scenario: Count shown
- **WHEN** a round's page is written
- **THEN** the page gives each language's files changed and code lines added, modified and removed, and a total

#### Scenario: Lock files left out
- **WHEN** the pull request changes `package-lock.json`
- **THEN** its lines are not in the count

#### Scenario: Count cannot be made
- **WHEN** cloc is not installed where the run works
- **THEN** the page says the count is unavailable in its place
- **AND** the rest of the page is written as usual

### Requirement: Content order
The page SHALL be titled after the pull request. It SHALL show, in this order: the change summary with its size, the key evidence, every screenshot, the red items, the other items (orange, then yellow), the decision log and the dispute log. The page MUST NOT show a preamble, a count line, an index table, a testing evidence section or white items.

#### Scenario: Summary comes first
- **WHEN** the reviewer opens a page from a run with screenshots
- **THEN** the change summary comes first, then the key evidence, then every screenshot, then the red items, the orange items, the yellow items, the decision log and the dispute log

#### Scenario: No white items or testing evidence
- **WHEN** the ranking has white items and the run has passing check results
- **THEN** the page shows neither the white items nor a testing evidence section

### Requirement: Key evidence and screenshots
The key evidence section SHALL show the acceptance screenshots the ranking picks, at most five, each with its title and a line on what it shows. After it, every acceptance screenshot SHALL appear, grouped by acceptance round, and each MUST open at full size. A run with no screenshots MUST have no key evidence section and no screenshot section.

#### Scenario: Key screenshots shown
- **WHEN** the ranking picks three key screenshots
- **THEN** the key evidence section shows those three, each with its title and line

#### Scenario: Screenshots grouped by round
- **WHEN** the run took screenshots in two acceptance rounds
- **THEN** every screenshot appears under its round
- **AND** each opens at full size

#### Scenario: No screenshots
- **WHEN** the run took no acceptance screenshots
- **THEN** the page has no key evidence section and no screenshot section

### Requirement: Codes are never alone
Wherever the page shows a code, it SHALL show the code's short title with it and link the code to its source.

#### Scenario: Code with its title
- **WHEN** an item cites a checklist code
- **THEN** the page shows the code with its short title
- **AND** the code links to where it is defined

### Requirement: Questions
Each red, orange and yellow item SHALL end with one or more questions. Each question SHALL offer two to four options, the recommended one first, then "Other" for a free-text answer. A yellow item's questions MUST have the recommended option preselected. A red or orange item's questions MUST start with no option chosen. Every question SHALL take an optional note. The page MUST NOT keep answers across a reload.

#### Scenario: Options and Other
- **WHEN** the reviewer reads a question
- **THEN** it shows two to four options with the recommended one first and named as recommended, then "Other"

#### Scenario: Yellow preselected, red and orange blank
- **WHEN** the page opens
- **THEN** each yellow question has its recommended option chosen
- **AND** each red and orange question has no option chosen

#### Scenario: Other needs text
- **WHEN** the reviewer chooses "Other" and writes nothing
- **THEN** the page does not count that question as answered

#### Scenario: Reload resets the answers
- **WHEN** the reviewer reloads the page before sending
- **THEN** every question is back to its state when the page first opened

### Requirement: Screenshot comments
The reviewer SHALL be able to comment on any screenshot, and the comments MUST go with the feedback.

#### Scenario: Comment on a screenshot
- **WHEN** the reviewer comments on a screenshot and sends feedback
- **THEN** the feedback includes the comment and names the screenshot and its round

### Requirement: Read-only content
The page's content SHALL be read-only: the reviewer answers questions and comments on screenshots, and changes nothing else. All text an agent wrote MUST show as text, never as markup or script.

#### Scenario: Agent text with markup
- **WHEN** an item's text contains HTML tags
- **THEN** the page shows the tags as text

### Requirement: Send feedback
The page SHALL have a "Send feedback" button. It MUST stay disabled until every red and orange question is answered, and the page SHALL say how many are left. Sending SHALL deliver every answer, note and screenshot comment, the page's round and the head it shows, as one answer to the run's wait.

#### Scenario: Unanswered questions block sending
- **WHEN** two red questions have no answer
- **THEN** "Send feedback" is disabled
- **AND** the page says two questions are left

#### Scenario: Feedback sent
- **WHEN** every red and orange question is answered and the reviewer clicks "Send feedback"
- **THEN** the run's wait receives one answer with the action feedback, every answer, note and screenshot comment, the page's round and its head

### Requirement: Merge
The page SHALL show a "Merge" button only when the run's archive and finalize passed. When red or orange items are on the page, Merge MUST first warn how many there are and that the answers on the page will not be sent. Merging SHALL send the action merge, the page's round and the head it shows to the run's wait.

#### Scenario: Merge hidden after a failure
- **WHEN** the archive or finalize did not pass
- **THEN** the page has no "Merge" button

#### Scenario: Merge warns about open items
- **WHEN** the page has one red item and two orange items and the reviewer clicks "Merge"
- **THEN** the page warns that three red or orange items are open and the answers will not be sent
- **AND** sends nothing unless the reviewer confirms

#### Scenario: Merge sent
- **WHEN** the reviewer confirms the merge
- **THEN** the run's wait receives one answer with the action merge, the page's round and its head

### Requirement: When the page cannot send
When the page cannot send an answer, it SHALL say why, send nothing and keep the reviewer's answers on the page. When it cannot reach the run's wait at all, it SHALL offer the answers as text to copy, with the Archon command that sends them. A page from a run with the wait turned off MUST show no buttons.

#### Scenario: Run not waiting for this page
- **WHEN** the reviewer sends from a page whose round the run is no longer waiting on
- **THEN** the page says the run is not waiting for this page and sends nothing
- **AND** the reviewer's answers stay on the page

#### Scenario: Archon cannot be reached
- **WHEN** the page cannot reach the run's wait, for example because it was opened as a file
- **THEN** the page says it cannot send from here
- **AND** offers the answers as text to copy, with the Archon command that sends them to the run's wait
- **AND** the command names the wait when the page has read it, and otherwise looks it up first

#### Scenario: Wait turned off
- **WHEN** the run had the wait turned off
- **THEN** the page shows no "Send feedback" or "Merge" button

### Requirement: After sending
Once an answer is sent, the page SHALL show what was sent and when, and disable both buttons.

#### Scenario: Feedback confirmed
- **WHEN** the run's wait accepts the reviewer's feedback
- **THEN** the page shows that feedback was sent and the time
- **AND** both buttons are disabled

### Requirement: An answered page is a read-only record
Once the run receives an answer from a page, that page SHALL show, whenever it is opened, what was sent from it: the options chosen, the notes, the screenshot comments, the action and when it was sent, with every input locked and no buttons. A page the reviewer merged from SHALL say that Merge was chosen and when. The record MUST show when the page is opened as a file too.

#### Scenario: Reopening an answered page
- **WHEN** the reviewer opens round 1's page after sending feedback from it
- **THEN** it shows the options they chose, their notes and screenshot comments, and when the feedback was sent
- **AND** nothing on it can be changed or sent

#### Scenario: Merged from the page
- **WHEN** the reviewer opens a page they chose Merge on
- **THEN** it says Merge was chosen and when, and has no buttons

#### Scenario: Unanswered page
- **WHEN** a page was never answered
- **THEN** it opens with its questions in their first state

### Requirement: Works as a file
The page SHALL show all its content, screenshots included, when opened from Archon and when opened as a file in a copy of the artifacts folder. Sending SHALL work only from Archon.

#### Scenario: Opened as a file
- **WHEN** someone opens the page from a copied artifacts folder
- **THEN** it shows its content and screenshots
- **AND** sending falls back to the copy offer
