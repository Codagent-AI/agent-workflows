## MODIFIED Requirements

### Requirement: Size of the change
Under the change summary, the page SHALL show a cloc count of the pull request against its base branch: by language, the files changed and the code lines added, modified and removed, with a total. Languages SHALL be listed by lines added, largest first, with the total last. Blank lines, comments and lock files MUST NOT be counted. When the count cannot be made, the page SHALL say so in its place and the package is still published.

#### Scenario: Count shown
- **WHEN** a round's page is written
- **THEN** the page gives each language's files changed and code lines added, modified and removed, and a total
- **AND** the language with the most lines added comes first and the total last

#### Scenario: Lock files left out
- **WHEN** the pull request changes `package-lock.json`
- **THEN** its lines are not in the count

#### Scenario: Count cannot be made
- **WHEN** cloc is not installed where the run works
- **THEN** the page says the count is unavailable in its place
- **AND** the rest of the page is written as usual

### Requirement: Key evidence and screenshots
The key evidence section SHALL show the acceptance screenshots and command evidence the ranking picks, at most five in all, each with its title and a line on what it shows. A command evidence entry SHALL also show its command and its excerpt. After it, all acceptance evidence SHALL appear, grouped by acceptance round: the round's command evidence, each entry showing its title and line and opening to its command and excerpt, then the round's screenshots, each of which MUST open in a viewer. The viewer SHALL open a screenshot fitted to its width, and a taller one SHALL scroll. It SHALL zoom in and out with buttons, ctrl and the scroll wheel, and a trackpad pinch, and its Fit button SHALL return to the width fit. On the page, the preview of a screenshot more than three times as tall as it is wide SHALL show its top at full width. An excerpt SHALL show its lines and spacing as the command printed them. The page MUST NOT show a command's full output. A run with no screenshots and no command evidence MUST have no key evidence section and no acceptance evidence section.

#### Scenario: Key screenshots shown
- **WHEN** the ranking picks two screenshots and one command evidence entry
- **THEN** the key evidence section shows those three, each with its title and line
- **AND** the command evidence entry shows its command and excerpt

#### Scenario: Screenshots grouped by round
- **WHEN** the run recorded evidence in two acceptance rounds
- **THEN** every command evidence entry and screenshot appears under its round
- **AND** each command evidence entry opens to its command and excerpt, and each screenshot opens in the viewer

#### Scenario: Tall screenshot
- **WHEN** a screenshot is 500 pixels wide and 8,600 tall
- **THEN** its preview shows its top at full width
- **AND** the viewer opens it at the viewer's width, scrolling down its length

#### Scenario: Zoom
- **WHEN** the reviewer zooms in on a screenshot and then presses Fit
- **THEN** the screenshot grows past the viewer's width, scrolling both ways, and Fit returns it to the viewer's width

#### Scenario: Only command evidence
- **WHEN** the run recorded command evidence and no screenshots
- **THEN** the page shows the key evidence and acceptance evidence sections with its command evidence

#### Scenario: No screenshots
- **WHEN** the run recorded no acceptance screenshots and no command evidence
- **THEN** the page has no key evidence section and no acceptance evidence section

### Requirement: Send feedback
The page SHALL have a "Send feedback" button that can always be clicked. Before a click, the page SHALL say how many concerns have unanswered red or orange questions. A click while any is unanswered MUST NOT send: the page SHALL mark each unanswered question, say which concerns hold them with a link to each, and scroll to the first. An Other answer with no text counts as unanswered. Sending SHALL deliver every answer, note and screenshot comment, the page's round and the head it shows, as one answer to the run's wait.

#### Scenario: Unanswered questions block sending
- **WHEN** concerns 1 and 3 have red questions with no answer and the reviewer clicks "Send feedback"
- **THEN** nothing is sent
- **AND** both questions are marked, the page says to answer the questions in concerns 1 and 3, with links to them, and it scrolls to concern 1's question

#### Scenario: Feedback sent
- **WHEN** every red and orange question is answered and the reviewer clicks "Send feedback"
- **THEN** the run's wait receives one answer with the action feedback, every answer, note and screenshot comment, the page's round and its head

### Requirement: Contents list
Beside its content, the page SHALL list its sections: Description, Key evidence when the page has it, and Concerns, with each tier's subheading and count and, under it, each concern's number and full title. A long title SHALL wrap rather than be cut off, and inline code in a title SHALL show as code. On a narrow screen the list SHALL show only the section links.

#### Scenario: Concerns in the list
- **WHEN** the page has two high concerns and one low concern
- **THEN** the list shows Concerns, then "High (2)" with both concerns, then "Low (1)" with its concern, each by number and title

#### Scenario: Long title
- **WHEN** a concern's title is longer than the list is wide
- **THEN** the list shows the whole title over several lines

#### Scenario: Narrow screen
- **WHEN** the page is narrower than the list and the content side by side need
- **THEN** the list shows only the section links, above the content

## ADDED Requirements

### Requirement: A comment on the summary
The summary SHALL have a comment box for anything without its own, such as the change size. Sending feedback SHALL include a nonblank summary comment as a note.

#### Scenario: Summary comment sent
- **WHEN** the reviewer writes "sort the size table" in the summary comment and sends feedback
- **THEN** the answer includes that comment as a note
