---
title: Reviewing a run
group: Guides
order: 4
description: The review page and its rounds, how concerns are ranked, the decision and dispute logs, and how to answer, retest and merge.
---

# Reviewing a run

Your review comes at the end of a run. The run publishes a review page that lists what needs your call, and waits. You answer its questions. You then send feedback, which runs another round, or you merge.

The wait has no time limit, and the run keeps its worktree while it waits. With the setting `review_wait: false`, the run publishes the page and ends instead, and the page shows no buttons. See [Roles and settings](roles-and-settings.md#pack-settings).

## Find the page

The page for the latest round is at one fixed address for the run:

```text
<archon address>/api/artifacts/<run-id>/review-page.html
```

The `codagent-archon` skill gives you this address when the run waits. Ask it for the page of a change name or a pull request, and it finds the run. Each round's page is also its own file, `review-page-round-<n>.html`, and the pull request description links each round's page when the `archon_url` setting names your Archon server.

The pull request description holds the change summary and the run's state: succeeded, or needs attention. It says how many high concerns need your call, and names the archive or finalize failure that hides Merge, if there is one. The page itself does not show the run's state.

## What the page shows

In this order:

1. **Header.** The round, the repository, a link to the pull request, the head the page shows, the run, links to the committed decision and dispute logs, and the number of concerns.
2. **Description.** The change summary and a size count by language, from `cloc`, for the pull request against its base. Lock files aren't counted. From round 2, it opens with "Since round n", a list of what the last round did with your feedback.
3. **Key evidence.** Up to five screenshots or command outputs the ranking picked, each with a title and a line on what it shows. A command shows its command and an excerpt of up to 20 lines. The full output stays in the run.
4. **All acceptance evidence,** grouped by acceptance round. Each screenshot opens in a viewer that fits the width, and zooms with buttons, ctrl and the scroll wheel, or a pinch. Fit returns it to the width.
5. **Concerns.** High, then Medium, then Low, numbered across the page.

A contents list sits beside the page. Every link that leaves the page goes to GitHub: the pull request, a committed file and line range at the page's head, a log, or a commit. Nothing links to the machine that ran the run.

The page shows no white items and no testing evidence section. What went right stays out, apart from the key evidence.

## Concerns and tiers

Every item that needs a person is a concern. The reviewer ranks each one into exactly one tier. The page labels the tiers High, Medium and Low.

| Tier | Meaning | Examples |
|---|---|---|
| High (red) | Check before you merge. Always shown. | A spec behavior that failed. A behavior still not verified after the recheck. Acceptance, the archive or finalize failed. A decision that departs from the definition. |
| Medium (orange) | Needs your judgment. | Commits made after acceptance. A review finding still disputed or never fixed. An audit finding the implementor didn't fix. A pull request comment left unfixed that could change behavior. A decision that changes scope, weakens a guarantee, affects other callers or is costly to reverse. |
| Low (yellow) | Probably fine. | A behavior a passing automated test verified, which acceptance didn't try. Any other decision or dispute, such as a style comment left unfixed. |

There is no white tier: what passed is not an item.

A script finds each item the run's own files require, and rejects a ranking that leaves one out or puts it lower. Items that share a root cause become one item, in the highest tier any of them reaches.

When a checklist row is `not verified` but names an automated test that a CI suite runs, and finalize passed CI, the row counts as verified by that test. Its item is Low, not High.

Each concern has a type tag:

| Type | What it covers |
|---|---|
| Risk | A spec behavior that is not verified |
| Failure | A spec behavior that failed, or a failed step: acceptance, a retest, the archive or finalize |
| Agent decision | An entry in the decision log |
| Dispute | An entry in the dispute log |
| Late commit | Commits after the accepted head |
| Human check | A check the test plan leaves to you |

A merged item lists each type it covers. Item text is written for a person, without decision codes or file paths in the prose.

## Questions

Each High, Medium and Low concern ends with one or more questions. A question offers two to four options, the recommended one first, then Other for free text. Every question takes an optional note.

- Low questions start with the recommended option chosen.
- High and Medium questions start with nothing chosen. You must answer them before you can send feedback.
- The page does not keep answers across a reload.

You can also comment on any screenshot or command output, and in a box under the summary for anything without its own place. These go with your feedback.

A failed step is a High concern. Its first line says what failed. Its options fit the cause. When the setup kept the tester from testing, it says nothing was tested and why, and doesn't offer to fix it in the next round.

## Send feedback

**Send feedback** can always be clicked. Before you click, the page says how many concerns have unanswered High or Medium questions. If any are unanswered, nothing is sent. The page marks them, links to each concern, and scrolls to the first.

Feedback is one answer to the run's wait: every answer, note and comment, the page's round, and its head. Then the page shows what was sent and when, and both buttons are disabled. Reopening the page later shows it as a read-only record, even from a copy of the artifacts.

A feedback round then:

1. Merges in the latest base branch, and the pull request branch's remote tip if it moved. It resolves conflicts and records any judgment call in the decision log. A conflict that needs a person becomes a High concern on the next page.
2. Has the implementor address each answer, note and comment.
3. Runs code review, with one fix round, and pushes.
4. Reruns the archive if it hadn't passed, then finalize.
5. Ranks again and publishes the next page.

There is no limit on rounds. A round with nothing to change still writes a new page. A failure in a step becomes a High concern on the next page, and the run still waits. An agent that fails outright fails the run, and resuming continues that round from your saved answers.

### Feedback that needs a spec change

The implementor does not change approved behavior on its own. If your answer asks for behavior the specs rule out, it logs a dispute, and the next page shows a High concern with three options: a specific spec edit the page spells out, merging without it and defining a follow-up change, or dropping it. A request for a new capability or a large revision gets only the follow-up and drop options.

The spec edit changes the spec and the code together, in the change's delta before the archive has passed and in `openspec/specs/` after it.

### Retest and review a late commit

A Late commit concern covers commits after acceptance, including a feedback round's own fixes. It lists each acceptance journey those commits could affect, with its code, title and the commit that touches it.

- **Retest** reruns the listed journeys in a new acceptance round, whose evidence joins the page. If it passes, the commits leave the concern. If it fails, the round doesn't fix it. The failure is a High concern on the next page.
- **Run a review round** has the reviewer review the commit, the implementor fix what it finds, and the reviewer check the fixes. It isn't offered when code review is off.

A commit stays on the page until a review round has read it, or you pick another option for it.

## Merge

**Merge** appears only when the archive and finalize passed. If High or Medium concerns are open, it first warns how many, and that your answers won't be sent. It sends the action merge, the page's round and the head it shows.

The run then merges the pull request through the forge at that head, and the run ends as succeeded whatever the page's items were.

- If the branch moved or no longer merges cleanly, the forge refuses. The run runs a round with no feedback, resolves conflicts, and publishes a new page that says why.
- If the repository's rules refuse, for example it needs an approval, the run asks again with the forge's reason and starts no round.
- If the forge can't say whether the merge happened, the run reads the pull request back.
- If you merged or closed the pull request yourself, your next answer ends the run: as merged, or as failed when it was closed.

The run never merges unless you choose Merge, and with the wait off or the run cancelled the pull request stays open.

## Answer from Archon's CLI or UI

The page sends through Archon. It can't send when opened as a file, or when the run is no longer waiting for that page's round. Then it says why, keeps your answers, and offers them as text to copy with the Archon command that sends them.

Archon's CLI and web UI answer the same wait with plain text:

- `merge` merges at the current page's head.
- Any other text is feedback for the current round, with the text as a note.
- An answer carrying an earlier round, or an empty answer, starts nothing. The run keeps waiting.

## What an answered run needs to continue

Archon stores your answer, but the run goes on only on a host that is running. Use `archon serve`, or run `archon workflow wake`. The host also needs `bun`, the forge and provider logins, and optionally `cloc`.

The page sends only to an Archon server without web login, or with its web UI origin configured. If the page can't reach the wait, it says so. See [Troubleshooting](troubleshooting.md#a-review-page-answer-does-not-continue-the-run).

## The two logs

The agents write both logs as they work. After acceptance a script numbers the entries and commits them in the change folder, so the archive keeps them and CI covers the commit. Later entries go into the committed logs. The page links to the logs and doesn't show their entries. The concerns on the page are the ranked view of them.

**The decision log**, `decision-log.md`, holds each point the definition didn't settle that an agent settled itself and that could change behavior, scope or integration. It also holds each high or medium review finding that the agents agreed not to fix. It has no entry for work that went as expected. Entries are numbered `DECIDE-1`, `DECIDE-2` and so on.

An illustrative entry:

```text
## DECIDE-7: Kept the CSV endpoint beside the new PDF export
- Step: acceptance fix, round 2
- Question: remove the CSV endpoint, or keep it?
- Decision: keep it
- Alternatives: remove it, or point it at PDF
- What breaks if wrong: callers of the CSV endpoint lose their data
- Rationale: two other callers use it
```

**The dispute log**, `dispute-log.md`, holds each high or medium review finding still disputed or never fixed, each audit finding the implementor held isn't a violation, and each pull request comment the finalize fixer didn't fix, with both sides. Entries are numbered `DISPUTE-1` and so on.

An illustrative entry:

```text
## DISPUTE-2: File names from titles aren't cleaned
- Reviewer: a "/" in a title breaks the path.
- Implementor: titles are checked on save.
```

An entry that only records your answer on a page is marked `Settled in review round <n>`. A settled dispute stays in the log but isn't ranked again.
