## DISPUTE-1: Audit finding 9 — private design documents are outside the revised implementation scope

Finding as given:

> 9. **`new`.** Definition: proposal, "Impact", Docs ("the design docs for the plugin and the overview").
>    - **Wrong:** I found no sign these were updated. The commit updates the READMEs, `AGENTS.md` and PROVENANCE. No checklist row, completion record or implementor decision mentions the two design docs.
>    - **Where:** I didn't find them among the tracked files, or by searching git history for added files named like design or overview docs outside `openspec/changes`. They may be kept outside this repository, which I couldn't check.

Requirement: The current proposal's Impact section requires updates to the repository README, the plugin's `AGENTS.md`, and PROVENANCE. It explicitly assigns the two private Claude pages to work outside this implementation.

Disposition: The finding described the proposal at audit time. Paul's commit `a7a892e` changed that scope. Leaving the private pages for the separate update is consistent with the current definition. See `evidence/design-artifact-scope.log` for the proposal diff and `evidence/resolve-findings-openspec.log` for validation of the revised change.
