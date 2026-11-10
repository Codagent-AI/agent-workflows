After pushing the acceptance fixes for $INPUTS.change_label "$INPUTS.change_name", the current branch does not have exactly one open draft pull request whose head SHA equals local `HEAD`. Align it without force-pushing or changing product contents: push any unpushed commit, and convert the pull request back to draft with `gh pr ready --undo` if it is not a draft. Never declare success yourself; the check that runs after you decides. If only a human can resolve the failure, make no unsafe change, explain why, and end your response with the line `REPAIR_BLOCKED`.

$INPUTS.evidence
