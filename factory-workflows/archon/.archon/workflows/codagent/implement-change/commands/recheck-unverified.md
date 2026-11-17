The acceptance rounds for OpenSpec change "$INPUTS.change_name" have ended. These rows of `$INPUTS.change_dir/checklist.md` are still marked `not verified`: $INPUTS.rows. Fixes after their last check changed the code, so nothing shows them passing at the current head.

Rerun the check each row's Evidence column names, integration and end-to-end tests included. Run each distinct command once, even when it covers several rows, with a timeout of 10 minutes (for example `timeout 600 <command>`). Save each run's output under `$ARTIFACTS_DIR/evidence/` and cite that file in the Evidence of every row it covers. Mark a row `verified` only when its check passed at the current head. When the check fails, mark the row `failed` and name the failure. When it cannot run, keep `not verified` and say why.

Change no other file: a failing check goes to the person who reviews the pull request, not into a fix now. Commit the checklist following the project's commit message conventions with the `[recheck]` prefix, and leave no tracked change uncommitted. Do not push; the workflow pushes. Do not run Agent Validator, directly or through any skill.

If only a human can unblock a check (a missing credential, permission, or service), keep the row `not verified` with that reason; that is not a blocked step. Set `blocked` to true only when you could not commit the checklist, and give the reason.
