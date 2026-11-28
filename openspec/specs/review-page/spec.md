# review-page Specification

## Purpose
TBD - created by archiving change add-review-page. Update Purpose after archive.

## Requirements

### Requirement: The page looks like the reference mockup
The page SHALL take its look and layout from the reference mockup kept with the `improve-review-page` change, `mockup/review-page.html` in the change's folder, wherever these specs do not say otherwise. The mockup's content and screenshots are samples, and its sending is a stand-in.

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

### Requirement: Content order
The page SHALL be titled after the pull request. It SHALL show, in this order: the header, the change summary with its size, the key evidence, all acceptance evidence, and the concerns. The page MUST NOT show a preamble, a count line, an index table, a testing evidence section, white items, or the entries of the decision log and dispute log.

#### Scenario: Summary comes first
- **WHEN** the reviewer opens a page from a run with acceptance evidence
- **THEN** the header comes first, then the change summary, the key evidence, all acceptance evidence, and the concerns: high, then medium, then low

#### Scenario: No white items or testing evidence
- **WHEN** the run has passing check results
- **THEN** the page shows no white items and no testing evidence section

#### Scenario: Logs are linked, not shown
- **WHEN** the run's decision log and dispute log have entries
- **THEN** the page links to both logs and does not show their entries

### Requirement: Key evidence and screenshots
The key evidence section SHALL show the acceptance screenshots and command evidence the ranking picks, at most five in all, each with its title and a line on what it shows. A command evidence entry SHALL also show its command and its excerpt. After it, all acceptance evidence SHALL appear, grouped by acceptance round: the round's command evidence, each entry showing its title and line and opening to its command and excerpt, then the round's screenshots, each of which MUST open in a viewer. The viewer SHALL open a screenshot fitted to its width, and a taller one SHALL scroll. It SHALL zoom in and out with buttons, ctrl and the scroll wheel, and a trackpad pinch, and its Fit button SHALL return to the width fit. On the page, the preview of a screenshot more than three times as tall as it is wide SHALL show its top at full width. An excerpt SHALL show its lines and spacing as the command printed them, with two exceptions. A line of compact JSON wider than 100 characters SHALL show indented, one field to a line, when converting it back gives exactly that line. A line too long for its box SHALL wrap rather than scroll sideways. The page MUST NOT show a command's full output. A run with no screenshots and no command evidence MUST have no key evidence section and no acceptance evidence section.

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

#### Scenario: Wide JSON line
- **WHEN** an excerpt is one line of compact JSON, 1,671 characters long
- **THEN** the page shows it indented, one field to a line, with long values wrapping in the box

#### Scenario: Line kept as printed
- **WHEN** an excerpt has a 140-character line of plain text, or of JSON with a space after each colon
- **THEN** the page shows that line as printed, wrapping it in the box

### Requirement: Questions
Each red, orange and yellow item SHALL have one or more questions, after its text and before its links. Each question SHALL offer two to four options, the recommended one first, then "Other" for a free-text answer. A yellow item's questions MUST have the recommended option preselected. A red or orange item's questions MUST start with no option chosen. Every question SHALL take an optional note. The page MUST NOT keep answers across a reload.

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
The reviewer SHALL be able to comment on any screenshot and any command evidence entry, and the comments MUST go with the feedback. Comments on command evidence SHALL be sent and recorded the way screenshot comments are. An entry the page shows in more than one place SHALL show its comment in each.

#### Scenario: Comment on a screenshot
- **WHEN** the reviewer comments on a screenshot and sends feedback
- **THEN** the feedback includes the comment and names the screenshot and its round

#### Scenario: Comment on command evidence
- **WHEN** the reviewer comments on a command evidence entry and sends feedback
- **THEN** the feedback includes the comment and names the entry and its round

#### Scenario: Entry shown twice
- **WHEN** a command evidence entry is in the key evidence and under its round, and the reviewer comments on one of them
- **THEN** both show the comment, and the feedback includes it once

### Requirement: Read-only content
The page's content SHALL be read-only: the reviewer answers questions and comments on evidence, and changes nothing else. All text an agent wrote MUST show as text, never as markup or script. The page SHALL show agent text's paragraphs, short lists, bold text and inline code as such. A run of lines starting with `- ` or `* ` SHALL show as a list, and a line directly above such a run SHALL show as its own line before the list.

#### Scenario: Agent text with markup
- **WHEN** an item's text contains HTML tags
- **THEN** the page shows the tags as text

#### Scenario: List under a lead-in line
- **WHEN** an item's text has "What covers it:" on one line and two lines starting with `- ` directly under it
- **THEN** the page shows "What covers it:" and then a list of the two

#### Scenario: Inline code
- **WHEN** an item's text has a command in backticks
- **THEN** the page shows the command as code

### Requirement: Send feedback
The page SHALL have a "Send feedback" button that can always be clicked. Before a click, the page SHALL say how many concerns have unanswered red or orange questions. A click while any is unanswered MUST NOT send: the page SHALL mark each unanswered question, say which concerns hold them with a link to each, and scroll to the first. An Other answer with no text counts as unanswered. Sending SHALL deliver every answer, note and screenshot comment, the page's round and the head it shows, as one answer to the run's wait.

#### Scenario: Unanswered questions block sending
- **WHEN** concerns 1 and 3 have red questions with no answer and the reviewer clicks "Send feedback"
- **THEN** nothing is sent
- **AND** both questions are marked, the page says to answer the questions in concerns 1 and 3, with links to them, and it scrolls to concern 1's question

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

### Requirement: Concerns
The page SHALL call each ranked item a concern, and SHALL label the tiers "High" for red, "Medium" for orange and "Low" for yellow wherever it names them. It SHALL show the concerns in one section headed "Concerns", with a subheading for each tier that has concerns, giving the tier's label and how many concerns it has. Concerns SHALL be numbered in order across the page. When there are no concerns, the section SHALL say so.

#### Scenario: Tier subheadings
- **WHEN** the page has one red item, two orange items and no yellow items
- **THEN** the Concerns section has the subheadings "High (1)" and "Medium (2)" and no Low subheading
- **AND** each concern's tag reads High or Medium

#### Scenario: Wording on the page
- **WHEN** two red and orange questions are unanswered, or the reviewer clicks "Merge" with one red and two orange items on the page
- **THEN** the page's status and warning name them as high and medium concerns

#### Scenario: No concerns
- **WHEN** the ranking has no items
- **THEN** the Concerns section says there are no concerns

### Requirement: Page header
Above the title the page SHALL show its round and the repository. Under the title it SHALL show a link to the pull request, the head the page shows, the run, links to the committed decision log and dispute log, and the number of concerns. The number SHALL link to the Concerns section, in the text color of the highest tier present, or neutral when there are none. The header MUST NOT show the run's state.

#### Scenario: Header contents
- **WHEN** the reviewer opens round 2's page
- **THEN** above the title it shows round 2 and the repository
- **AND** under the title it links to the pull request, shows the head and the run, links to both logs and shows the number of concerns

#### Scenario: Number in the highest tier's color
- **WHEN** the page's concerns are orange and yellow
- **THEN** the number of concerns shows in orange text

#### Scenario: A log the change does not have
- **WHEN** the change has no committed dispute log
- **THEN** the header links only to the decision log

### Requirement: Links go to GitHub
Every link that leaves the page SHALL go to GitHub: the pull request, a committed file and its line range at the page's head, the committed decision or dispute log at that head, or a commit. The page MUST NOT link to or name a file in the run's artifacts folder or on the machine that ran it. A link in agent text to anywhere else SHALL show as its label only.

#### Scenario: Link to a committed file
- **WHEN** an item links to a range in a committed file
- **THEN** the link opens that file and range on GitHub at the page's head

#### Scenario: Link outside GitHub in agent text
- **WHEN** an item's text has a link to a page outside GitHub
- **THEN** the page shows the link's label as text, with no link

### Requirement: Concern layout
Each concern SHALL show, in this order: its tier and type tags, its title, for a failed step the line saying what failed, its text, the command evidence entry it names if any, its questions, and its labeled links under "On GitHub" when it has any. Its title SHALL show inline code as code.

#### Scenario: Failed step
- **WHEN** a concern is a failed acceptance
- **THEN** the line saying what failed shows under its title, set apart from its text

#### Scenario: Concern names command evidence
- **WHEN** a concern names a command evidence entry
- **THEN** the entry shows in the concern with its command and excerpt, before the questions

#### Scenario: Links last
- **WHEN** a concern has two labeled links
- **THEN** they show after its questions under "On GitHub", each with its label

#### Scenario: Concern without links
- **WHEN** a failed step's concern has no links
- **THEN** it ends with its questions and shows no "On GitHub" block

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

### Requirement: A comment on the summary
The summary SHALL have a comment box for anything without its own, such as the change size. Sending feedback SHALL include a nonblank summary comment as a note.

#### Scenario: Summary comment sent
- **WHEN** the reviewer writes "sort the size table" in the summary comment and sends feedback
- **THEN** the answer includes that comment as a note
