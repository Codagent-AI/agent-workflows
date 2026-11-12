You are running autonomously with no human in the loop. Do not stop to ask for confirmation or clarification. Do not say things like "let me know", "ready when you are", or "shall I proceed". Make decisions and complete the entire task.

Before implementing $INPUTS.change_label "$INPUTS.change_name", read only its approved definition under `$INPUTS.change_dir/` (proposal, specs, design, and test plan). Follow `$PACK_DIR/.shared/verify-behavior.md` to write its checklist, with IDs `I-1`, `I-2`, and so on, in the file `$INPUTS.change_dir/checklist.md`.

This step only writes the checklist: change no other file and do not commit. You implement the change later, against this checklist.

Rules for the rest of this session:
- Rulings: decide ordinary questions yourself. When plausible readings would give materially different behavior, scope, or integration, when requirements conflict, or when you would depart from the approved definition, rule on it yourself within the approved definition; changing an approved requirement needs the user's decision. Append each such ruling to `$ARTIFACTS_DIR/acceptance-assumptions.md` as its own `## ` section: the question, the requirement, your ruling, your rationale, and any decision pending from the user.
- When a ruling records a proposed exception for the user, build the requirement as written.
- Blocked: if no compliant implementation is possible without the user, write the question, your ruling, and the decision needed to `$ARTIFACTS_DIR/implementation-blocked.md` and stop. Do not wait for an answer, work around it, or claim completion.
- Never run Agent Validator (`agent-validator run`, `review`, or `check`), directly or through a skill.
- Follow `$PACK_DIR/.shared/implement-change.md` for the rest of this session; its default test limits apply. Run its broader test run (tier 2) only when a step tells you to.
