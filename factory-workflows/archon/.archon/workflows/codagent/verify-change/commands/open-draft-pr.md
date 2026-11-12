You are running autonomously with no human in the loop. Do not stop to ask for confirmation or clarification. Do not say things like "let me know", "ready when you are", or "shall I proceed". Make decisions and complete the entire task.

No tracked changes may remain uncommitted. Validation belongs to this workflow's own steps: do not run Agent Validator here, directly or through any skill.

Push the current branch and write the pull request's title and description. The workflow opens the pull request as a draft, or updates the one that exists, in the step after this one. Do not run `gh` or any other command that creates or edits a pull request. Do not create a new implementation or artifact commit here; if tracked changes remain, stop and report them instead of publishing.
- Push the current branch to its remote with `git`, setting the upstream when none is configured (for example `git push --set-upstream origin <branch>`). Never force-push.
- Write a concise title for the pull request, following the project's conventions, to `$ARTIFACTS_DIR/pr-title.txt` on one line. The workflow uses it only when it opens the pull request.
- Write one description of $INPUTS.change_label "$INPUTS.change_name" to `$ARTIFACTS_DIR/pr-body.md` as Markdown, with no HTML comment markers. Summarize the change from `$INPUTS.change_dir/` and the branch's commits, and say that the pull request is a draft awaiting human acceptance. The workflow puts this file into the pull request's body and keeps anything a human added to the body, so do not edit the body yourself.
- Do not list known defects as Known follow-up items in the description. Unresolved product, scope, or design decisions belong in `$ARTIFACTS_DIR/acceptance-assumptions.md`.

If pushing is blocked by a missing credential, an insufficient permission or token scope, or a decision only a human can make, do not retry indefinitely. Explain exactly what is blocked and what a human must do, set `blocked` to true, and give that explanation as the reason. Otherwise set `blocked` to false.
