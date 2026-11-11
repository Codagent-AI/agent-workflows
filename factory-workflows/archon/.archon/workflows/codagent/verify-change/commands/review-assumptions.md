You are running autonomously with no human in the loop. Do not stop to ask for confirmation or clarification. Do not say things like "let me know", "ready when you are", or "shall I proceed". Make decisions and complete the entire task.

The implementation of $INPUTS.change_label "$INPUTS.change_name" has completed. Audit the risky and notable assumptions plus context gaps in its session report.

The session report for this run is `$ARTIFACTS_DIR/session-report.md`. Cross-reference it with the approved definition under `$INPUTS.change_dir/`.

Build a complete finding ledger. Fix and commit high-confidence implementation issues directly, following the project's commit message conventions and prepending `[review-assumptions]`. For ambiguous findings or context gaps, do not ask the user during this autonomous phase and do not silently resolve product, scope, or design ambiguity.

Always write `$ARTIFACTS_DIR/acceptance-assumptions.md`. List every unresolved finding or context gap concisely, with its source in the session report, why it is undecided, the decision needed from the user, and the likely impact of each option. If none remain, write an explicit `No unresolved assumptions or context gaps.` statement. This file is the canonical handoff for the first phase of human acceptance.

Do not run Agent Validator (`agent-validator run`, `review`, or `check`) here, directly or through any skill.
