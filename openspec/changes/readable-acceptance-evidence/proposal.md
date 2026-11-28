## Why

The first review page for a real change, "feat: run OpenSpec crosschecks through acpx", read well, but its acceptance evidence fell short in two ways:

- **Its only High concern was the workflow's own slip.** For the check of leftover processes and private logs, the tester saved one wording of the result and quoted another, with process IDs the saved file lacks. The page leaves out a quote it can't find in the saved output, and reports it as a failure. Nothing checks the quotes until the page is built, after acceptance ends, so the tester never had a chance to correct it. A record the tester could have fixed in seconds reached the person as the one item needing their call.
- **Most evidence couldn't be read.** 31 of its 36 quotes had lines wider than their box, mostly compact JSON on one line, up to 1,671 characters. The box doesn't wrap, so the reviewer saw about the first 90 characters and had to scroll sideways for the rest, such as the three reviews in "Three real reviewers run together".

## What Changes

1. **The tester corrects evidence the page would leave out.**
   - After the tester's pass in each acceptance round and each retest, the workflow reads that round's screenshot, command and journey records as the page will, and lists each problem with its file.
   - The tester's handoff, which already resumes its session after the CI wait, receives the list and corrects each record. It copies a command's quote from the saved output, never the other way round.
   - A record still wrong after the handoff is left off the page and reported, as before.
2. **Wide quotes can be read.**
   - A line of compact JSON wider than 100 characters shows indented, one field to a line. Only its spacing changes: a line that doesn't convert back to exactly the same text shows as printed.
   - Any line too long for the box wraps instead of scrolling sideways.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acceptance-rounds`: the handoff receives this round's evidence problems and corrects them.
- `review-page`: wide JSON lines in a quote show indented, and long lines wrap.

## Technical Approach

- **Round check.** `roundProblems` in `review-media.ts` runs the page's own evidence readers and keeps the problems under this round's folders and journey file, as a list of `- <path>: <problem>` lines, or `none`. A new script, `check-round-evidence`, prints it. It runs as `check-round-evidence` after `acceptance-test` and as `check-retest-evidence` after `retest-journeys`, and never fails. Each handoff node gains the input `evidence_problems`, and the `acceptance-handoff` prompt gains a short section on correcting them.
- **Display.** `displayExcerpt` in `review-send.ts`, which the page already inlines, indents each JSON line over 100 characters that parses to an object or array and re-serializes to itself. `review-page.js` shows quotes through it. In `review-page.css`, `.excerpt` wraps (`pre-wrap`, `overflow-wrap: anywhere`).
- The quote check itself, the saved evidence and the page's data are unchanged.

## Out of Scope

- Ranking an evidence problem below High. Once the tester can correct it, one that remains is a real gap in what the page can show.
- Checking the records again after the handoff.

## Impact

- **Pack code and prompts.** `implement-change.yaml`, a new `check-round-evidence.ts`, `review-media.ts`, `review-send.ts`, `review-page.js` and `.css`, the `acceptance-handoff` prompt, and the fixtures and tests.
- **Cost.** No new agent call. The handoff may spend a few turns correcting records.
- **Eval harness.** No artifact the judges read changes.
