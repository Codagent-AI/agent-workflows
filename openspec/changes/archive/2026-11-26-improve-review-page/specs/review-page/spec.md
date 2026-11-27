## MODIFIED Requirements

### Requirement: The page looks like the reference mockup
The page SHALL take its look and layout from the reference mockup kept with the `improve-review-page` change, `mockup/review-page.html` in the change's folder, wherever these specs do not say otherwise. The mockup's content and screenshots are samples, and its sending is a stand-in.

#### Scenario: Styling not set by a spec
- **WHEN** the specs do not say how a part of the page looks or where it goes
- **THEN** the page shows it the way the reference mockup does

#### Scenario: Spec and mockup differ
- **WHEN** a spec says how the page behaves and the mockup behaves otherwise
- **THEN** the page follows the spec

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
The key evidence section SHALL show the acceptance screenshots and command evidence the ranking picks, at most five in all, each with its title and a line on what it shows. A command evidence entry SHALL also show its command and its excerpt. After it, all acceptance evidence SHALL appear, grouped by acceptance round: the round's command evidence, each entry showing its title and line and opening to its command and excerpt, then the round's screenshots, each of which MUST open at full size. An excerpt SHALL show its lines and spacing as the command printed them. The page MUST NOT show a command's full output. A run with no screenshots and no command evidence MUST have no key evidence section and no acceptance evidence section.

#### Scenario: Key screenshots shown
- **WHEN** the ranking picks two screenshots and one command evidence entry
- **THEN** the key evidence section shows those three, each with its title and line
- **AND** the command evidence entry shows its command and excerpt

#### Scenario: Screenshots grouped by round
- **WHEN** the run recorded evidence in two acceptance rounds
- **THEN** every command evidence entry and screenshot appears under its round
- **AND** each command evidence entry opens to its command and excerpt, and each screenshot opens at full size

#### Scenario: Only command evidence
- **WHEN** the run recorded command evidence and no screenshots
- **THEN** the page shows the key evidence and acceptance evidence sections with its command evidence

#### Scenario: No screenshots
- **WHEN** the run recorded no acceptance screenshots and no command evidence
- **THEN** the page has no key evidence section and no acceptance evidence section

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

## REMOVED Requirements

### Requirement: Codes are never alone
**Reason**: Items no longer show decision or checklist codes. Each item ends with labeled links to its sources instead.
**Migration**: The ranking names each source as a labeled link target, and the page shows those links at the end of the item.

## ADDED Requirements

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
Beside its content, the page SHALL list its sections: Summary, Key evidence when the page has it, and Concerns, with each tier's subheading and count and, under it, each concern's number and full title. A long title SHALL wrap rather than be cut off, and inline code in a title SHALL show as code. On a narrow screen the list SHALL show only the section links.

#### Scenario: Concerns in the list
- **WHEN** the page has two high concerns and one low concern
- **THEN** the list shows Concerns, then "High (2)" with both concerns, then "Low (1)" with its concern, each by number and title

#### Scenario: Long title
- **WHEN** a concern's title is longer than the list is wide
- **THEN** the list shows the whole title over several lines

#### Scenario: Narrow screen
- **WHEN** the page is narrower than the list and the content side by side need
- **THEN** the list shows only the section links, above the content
