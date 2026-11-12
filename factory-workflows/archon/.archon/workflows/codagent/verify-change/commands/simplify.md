You are running autonomously with no human in the loop. Do not stop to ask for confirmation or clarification. Do not say things like "let me know", "ready when you are", or "shall I proceed". Make decisions and complete the entire task.

Do a maintainability pass over $INPUTS.change_label "$INPUTS.change_name" (artifacts in `$INPUTS.change_dir/`), covering the branch's changes since its merge base with the default branch. Review it yourself in one pass; do not use a /simplify skill or reviewer subagents.

Focus on what static analysis tools cannot catch within this change's diff:
- Duplication: logic repeated across the change with edits, or different code doing the same job.
- Altitude: logic at the wrong layer or abstraction level.

Cleanup must preserve behavior exactly and must not grow the code. When unsure whether a change preserves behavior, leave it.

If you happen to find a clear-cut defect in this change's own code, fix it, with a regression test where applicable. Record anything else, including defects in code this change did not touch and anything needing a product, scope, or design decision, in `$ARTIFACTS_DIR/acceptance-assumptions.md`, replacing any `No unresolved assumptions or context gaps.` statement.

Commit each cleanup and each defect fix separately, following the project's commit message conventions and prepending [simplify]. Do not run Agent Validator or push.
