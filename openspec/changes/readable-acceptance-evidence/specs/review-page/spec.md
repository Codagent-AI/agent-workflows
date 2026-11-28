## MODIFIED Requirements

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
