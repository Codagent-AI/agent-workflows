## PR comment: Publish the round page before updating its PR link

- ID: DISPUTE-1
- File: `factory-workflows/archon/.archon/workflows/codagent/.shared/lib/publish-review.ts:82`
- Author: coderabbitai
- Request: Write the numbered page before editing and verifying the generated PR description.
- Disposition: Unresolved. A failed page write can leave a broken link. The approved design explicitly updates the description first in a feedback round so a description failure can become a red item on that page. Changing publication order or adding a separate publication protocol needs acceptance or planning approval.

## PR comment: Revalidate the archive for each published head

- ID: DISPUTE-2
- File: `factory-workflows/archon/.archon/workflows/codagent/.shared/lib/publish-review.ts:99`
- Author: coderabbitai
- Request: Require a new archive result for each feedback round's published head before enabling Merge.
- Disposition: Unresolved. The approved archive lifecycle reuses a passing archive and reruns the archive steps only when it has failed. A fresh per-head archive validation gate is a new requirement that needs acceptance or planning approval.

## PR comment: Prove that CI executed the cited test in code

- ID: DISPUTE-3
- File: `factory-workflows/archon/.archon/workflows/codagent/.shared/lib/review-inventory.ts:43`
- Author: coderabbitai
- Request: Require direct runner evidence before giving a checklist row a yellow tier floor.
- Disposition: Unresolved. Passing lint alone does not establish execution. The approved design deliberately assigns suite membership to the ranker, which is instructed to raise the row to red when CI did not run the test. Replacing this split with a code gate needs acceptance or planning approval.

## PR comment: Apply selected spec edits after a partial archive move

- ID: DISPUTE-4
- File: `factory-workflows/archon/.archon/workflows/codagent/implement-change/implement-change.yaml:1169`
- Author: coderabbitai
- Request: Ensure a selected spec edit reaches the canonical spec when the archive folder moved but the archive result has not passed.
- Disposition: Unresolved. The gap is real. The approved design selects the delta until the archive passes. The spec describes a direct canonical edit after the change is archived. They do not settle what to do when the move applies the delta but a commit or verification fails. Accepting a new edit route here requires a planning or acceptance decision on which state controls and how to preserve unrelated work.
