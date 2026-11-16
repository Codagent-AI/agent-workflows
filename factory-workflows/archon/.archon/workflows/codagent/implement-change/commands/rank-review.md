You are running autonomously with no human in the loop. Do not stop to ask for confirmation or clarification. Do not say things like "let me know", "ready when you are", or "shall I proceed". Make decisions and complete the entire task.

Read the change's definition, its checklist, decision-log.md and dispute-log.md in $INPUTS.change_folder, and the review results in $ARTIFACTS_DIR/review/. Read acceptance-preparation-status.txt, acceptance-handoff.md, exploration-log.md, acceptance-findings.md from $ARTIFACTS_DIR/. Also read commits after acceptance: the accepted head is $INPUTS.accepted_head, and $INPUTS.later_commits lists the commits after it, leaving out those that touch only openspec/.

The decision log holds, numbered D-01 and on, each question the definition did not settle that an agent settled during the run, and each high or medium review finding whose decline the reviewer accepted. The dispute log holds, with both sides, each high or medium review finding still disputed or never fixed when the run ended, each audit finding the implementor did not fix, and each pull request review comment fix-pr did not fix. A review finding is disputed when the reviewer still contests a decline after the implementor's reply.

 Give your ranking as your structured output: red, orange, yellow and white arrays of {type, title, detail, link, source}, where type names what the item is (Verification for a spec behavior's result, Decision for a decision-log entry, Dispute for a dispute-log entry, Late commit for the commits after the accepted head, or Human check for a check the test plan leaves to the person; an item merged from several kinds lists each), source lists the checklist row IDs, decision IDs, dispute IDs or commit SHAs the item covers, and evidence, the testing evidence summary described below. Name every commit after the accepted head by SHA in an orange item. A link is a repository-relative path of a committed file, citing the line or range that shows the item (path:12 or path:12-18) where one exists, or a URL; any other path is shown as plain text.

 The workflow adds a red item for each failed acceptance, archive or finalize; do not add one.

Classify every review item into exactly one tier, and make items that share one root cause a single item in the highest tier any of them reaches, its detail listing each symptom.

Red: each spec behavior that failed, each that could not be verified and that no automated test covers, acceptance that did not complete, and every known deviation from the definition.

Orange: choices the definition did not settle that change scope, weaken a guarantee, affect other callers, or are costly to reverse; declined, disputed or never fixed high or medium review findings and audit findings the implementor did not fix; review comments fix-pr did not fix where leaving them could change behavior or weaken a guarantee; and commits added after acceptance that its evidence does not cover. The item naming those commits states their size as `git diff --shortstat $INPUTS.accepted_head HEAD --. ':(exclude)openspec'` prints it (N files changed,...) and has a sentence starting `Tests:` that names the tests covering them or says none do. Group related orange choices into one item per topic whose detail cites the decision IDs behind it, and order orange most important first: the pull request shows commits after acceptance first, then the most important remaining orange items, up to five in total, and collapses the rest.

Yellow: each spec behavior acceptance did not exercise but a named automated test covers, naming that test in its detail and linking it where possible; and every other recorded decision or dispute.

White: passed spec behaviors with evidence.

Write evidence as Markdown for the person who reviews the pull request: each spec behavior's verdict and evidence from the checklist, what the acceptance tester exercised and what it did not, text equivalents of its screenshots, the human-only checks the test plan reserves for a person, and each commit after the accepted head with the tests that cover it. Name the paths of screenshots and logs in $ARTIFACTS_DIR instead of copying them, and do not repeat CI results.

Change no file.
