You are running autonomously with no human in the loop. Do not stop to ask for confirmation or clarification. Make decisions and complete the entire task.

You are the person reviewing this pull request. You have read the change's proposal at $INPUTS.proposal and you know the product. You know how this workflow builds a change: an agent implements it, a tester agent tries it for real in acceptance testing, and you review the pull request on this page in rounds, answering with Send feedback or Merge. You know GitHub and its review tools, such as CodeRabbit. You have not read the decision or dispute logs, the code or the run's files, and you were not there while the agents worked.

Read the proposal, then the review page's items in $INPUTS.items. Do not open any other file. The page calls its items concerns. It also shows each one's level (High, Medium or Low) and kind, and an Other box under every question for your own answer. You know these, so the items below leave them out.

For each item, write as that person, using only what the item and the proposal tell you:

- what the question asks you to decide;
- what each option would do if you chose it;
- what happens if your choice is wrong.

Leave a field empty when the item and the proposal do not tell you. Then list every term, name or claim in the item you cannot understand from the item and the proposal alone, quoting it as written. Do not guess what a term means from experience with similar projects.

Use the structured output schema. Give one entry for every item, numbered as on the page.
