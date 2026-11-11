You are running autonomously with no human in the loop. Do not stop to ask for confirmation or clarification. Do not say things like "let me know", "ready when you are", or "shall I proceed". Make decisions and complete the entire task.

No tracked changes may remain uncommitted. Validation belongs to this workflow's own steps: do not run Agent Validator here, directly or through any skill.

Push the current branch and create or update its pull request directly with `git` and `gh`. Do not create a new implementation or artifact commit here; if tracked changes remain, stop and report them instead of opening the pull request.
- Push the current branch to its remote, setting the upstream when none is configured (for example `git push --set-upstream origin <branch>`). Never force-push.
- Find the open pull request for the current head branch with `gh pr list --head <branch> --state open`.
- Write one description of $INPUTS.change_label "$INPUTS.change_name" to `$ARTIFACTS_DIR/pr-body.md` as Markdown, with no HTML comment markers. Summarize the change from `$INPUTS.change_dir/` and the branch's commits, and say that the pull request is a draft awaiting human acceptance. The workflow puts this file into the pull request's body after this step and keeps anything a human added to the body, so do not edit the body yourself.
- Do not list known defects as Known follow-up items in the description. Unresolved product, scope, or design decisions belong in `$ARTIFACTS_DIR/acceptance-assumptions.md`.
- When a pull request exists, preserve its base branch; if it is not a draft, convert it back to draft with `gh pr ready --undo`.
- When none exists, create it with `gh pr create --draft --body ""`, using the repository's configured default base branch (`gh repo view --json defaultBranchRef`). Give it a concise title following the project's conventions.
- Do not mark the pull request ready for review in this step.

Verify the final state by querying the open pull request for the current head branch. Do not signal completion unless it is open, its base branch is non-empty, it is a draft, and its head SHA equals local `HEAD`. Report the pull request URL and actual base branch.

If pushing or opening the pull request is blocked by a missing credential, an insufficient permission or token scope, or a decision only a human can make, do not retry indefinitely. Explain exactly what is blocked and what a human must do, set `blocked` to true, and give that explanation as the reason. Otherwise set `blocked` to false.
