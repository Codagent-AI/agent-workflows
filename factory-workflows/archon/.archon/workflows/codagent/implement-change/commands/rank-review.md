You are running autonomously with no human in the loop. Do not stop to ask for confirmation or clarification. Do not say things like "let me know", "ready when you are", or "shall I proceed". Make decisions and complete the entire task.

Read the change's definition, its checklist, decision-log.md and dispute-log.md in $INPUTS.change_folder, and the review results in $ARTIFACTS_DIR/review/. Read acceptance-preparation-status.txt, acceptance-handoff.md, exploration-log.md, acceptance-findings.md from $ARTIFACTS_DIR/. Also read commits after acceptance: the accepted head is $INPUTS.accepted_head, and $INPUTS.later_commits lists the commits after it, leaving out those that touch only openspec/.

The decision log holds, numbered DECIDE-1 and on, each question the definition did not settle that an agent settled during the run, and each high or medium review finding whose decline the reviewer accepted. The dispute log holds, with both sides, each high or medium review finding still disputed or never fixed when the run ended, each audit finding the implementor did not fix, and each pull request review comment fix-pr did not fix. A review finding is disputed when the reviewer still contests a decline after the implementor's reply.

Use the structured output schema. Each item names its type, title, detail, labeled links, source codes and command evidence. Include every applicable type when an item merges several symptoms. A link has a label and a target. Use a committed path with #L1 or #L1-L3, commit:<sha>, or log:<entry code>. Never supply a URL or a run file. Use an empty links array only for failed steps with no committed source. Group symptoms with one root cause in the highest applicable tier.

- Red includes failed behaviors, unverified rows except the CI case below, departures from the definition and spec-change disputes. Include one red Failure concern with the corresponding failure:<step> source for each failed step in review/required.json. Combine symptoms of that cause in the same concern.
- Orange includes material decisions affecting scope, guarantees, callers, reversibility, cost, security, performance, test strength or maintainability, declined high or medium review findings (including accepted declines), and unresolved high or medium review findings, unfixed audit findings, consequential PR comments, and commits after the accepted head. Link each late commit and include its shortstat and a sentence starting with Tests that names coverage or says none applies. Use the supplied late commit list, which already omits imported base commits and clean base merges.
- Yellow includes behaviors only automated tests checked, other decisions and disputes, and style-only unfixed PR comments when warranted. Name and link a test where it covers the behavior.
- Yellow is only for items you recommend accepting as they are, with no further work. When an item you would rank yellow needs a retest, a fix, a review or any other work, rank it orange instead. Red and orange items may still recommend accepting them as they are.
- A behavior acceptance never tried is one whose checklist evidence is only a test run, and that the acceptance tester's reports and screenshots do not show. Group them by the feature they belong to, one Risk item per feature, saying what a person has not yet seen working and which tests check it. Leave out behaviors acceptance tried and saw pass. Rank every open decision and dispute, including PR comments. Read review/required.json for required sources and minimum tiers. Judge a decision by the cost of being wrong, including decisions that change no product behavior.

Write evidence for the ranking handoff: each spec behavior's verdict and evidence from the checklist, what the acceptance tester exercised and what it did not, text equivalents of its screenshots, the human-only checks the test plan reserves for a person, and each commit after the accepted head with the tests that cover it. Name the paths of screenshots and logs in $ARTIFACTS_DIR instead of copying them, and do not repeat CI results.

Change no file.

For review round $INPUTS.review_round, use the saved answers at $INPUTS.answers_file when provided and the matching review-response record. A CI test counts as verification only if a passed finalize suite ran it. Keep that item yellow and name the test. If the cited test is outside CI, rank it red. Use Risk for unverified behavior, Failure for failed behavior, Agent decision for decisions, Dispute for disputes, Late commit for commits after the accepted head, and Human check for checks left to the reviewer. Read the extracted human-only checks in $ARTIFACTS_DIR/review/human-checks.json. Keep old source codes where the source uses them.

Add questions to every red, orange and yellow item, with a prompt and two to four options. Each option has an id, label and detail (empty if unnecessary). Put the recommendation first. Other is added by the page. Ask one question per spec-change dispute, in the order of the dispute codes in the item’s source list. Each dispute question must offer exactly follow-up and drop, using those IDs, unless it offers the targeted edit described below. Add a separate Retest question last if the grouped item also lists journeys. Include spec-edit as a third option only when the dispute records a targeted edit, and put the exact edit in its detail. Choose one to five screenshots or command evidence entries in total as keyEvidence when available, and none otherwise. Pick the ones that show the change working as a person would see it, such as full views of the product in a live or real run, over test images and close-ups of one detail. Use the file IDs from $ARTIFACTS_DIR/review/evidence.json and supply title and shows.

When a grouped item has sources without a dedicated dispute question, give those sources a shared question after the dedicated questions. A Retest question can serve as that shared question when the item lists journeys.

For the Late commit item, read the journeys that were exercised from the acceptance-journeys round files. List each affected journey with its code, title and touching commit. Include an option with ID retest and label Retest only when journeys are listed. Every Late commit item also offers an option with ID review-round and label Run a review round: the next round's reviewer reviews the commit, the implementor fixes what it finds, and the reviewer checks the fixes. Keep each item's source codes and use an empty journeys array for items without journeys.

Write for the person reviewing. State what happened or what is at stake in the title. In short paragraphs and lists, describe what the user types or sees, and give a short list of what covers the behavior and what remains untested. Leave decision and checklist codes, source paths, line numbers and agent history out of readable text. A filename the user works with is fine. Use labels such as “How the agent decided” on source links. Name each agent by its role, such as “the code review agent”, use “you” only for the person reviewing, and never write as “I” or “we”.

The person reviewing has read the change's proposal, knows the product and knows how this workflow builds a change. They have not read the decision or dispute logs, the code or the run's files, and they were not there while the agents worked. Explain or replace any term from those places. Each item must let them decide from the page alone: what is at stake, what each option would do, and what happens if the choice is wrong. Their answers reach the next round when they press Send feedback, and Merge is a separate button, so an option never merges: say what the next round does with it.

For example, this item fails that reader:

<example-before>
Title: Reviewers cannot retest one journey on its own
The acceptance tester wanted every recorded scenario and its repeat steps shown, with Retest offered for each. The agent kept the approved flow: Retest is offered only on a Late commit item that lists the journey. A journey no late commit touches has no Retest option. Writing the journey records with the right field names was fixed and the round-1 retest read them back without problems.
Covered by: the manifest reader and publish-to-Retest cases in the tests, and the retest read. Not exercised: a live feedback and Retest cycle on a page.
</example-before>

Written for the reader, it says:

<example-after>
Title: You can only ask for a retest of tests a late commit touched
Acceptance tests the change by walking through scenarios, such as "open the review page and send feedback." When commits land after acceptance, the page shows an item for them with a Retest option, and choosing it reruns the scenarios those commits touched.
There is no way to rerun any other scenario from the page. If you doubt a result the late commits didn't touch, the page can't send it back for a retest.
The acceptance tester asked for a Retest option on every scenario. That wasn't built, because the approved spec puts Retest only on the late-commit item.
Not yet tried: choosing Retest on a real page and watching the retest run.
Question: Should every scenario get its own Retest option?
- Keep as approved: Retest stays on the late-commit item only.
- Follow-up change: add a Retest option for each scenario after this merges.
</example-after>

For a defect found in acceptance, say what the tester did, expected and saw. Put the matching command entry's file ID in evidence, or use an empty string if there is no cited command. For a failed step, use the tester's reports, step-results.json and review/media-problems.json to explain the cause, who can address it, and what was left untested or undone and what covers it instead. Link the committed decision if a blocked acceptance fix needs a reviewer's call. Do not reproduce raw reports. Offer options that fit the cause, such as resolving setup before retesting when the tester never reached the product. For setup failures, do not offer fixing the product in the next round. The publisher supplies the fixed failure line.

Ask each question about the product or pull request. In one line per option, say what choosing it does.
