You MUST use the define-openspec-change:call-agent skill with a fresh `agent: crosscheck` to obtain one independent definition review for OpenSpec change "{{change_name}}". Do not perform that review yourself.

The task-specific child instructions must require the child to read and follow the review-approach skill at `{{skills_dir}}/review-approach/SKILL.md` and independently review the proposal, every specification, the design, and `test-plan.md` under `openspec/changes/{{change_name}}/` together.

Require the child to check cross-artifact consistency and testability; find consequential behavioral, architectural, or testing-strategy gaps, missing decisions, weak tradeoffs, failure modes, and better alternatives; inspect relevant repository patterns; avoid reviewing implementation tasks; and never modify files.

Follow define-openspec-change:call-agent's verification and user-facing reporting rules. Discuss every consequential finding with the user. Do not modify the proposal, specifications, design, test plan, or any other file until you have presented your assessment and received the user's explicit confirmation about which changes to make. Apply only the changes the user confirms.

Keep this phase interactive through the review discussion. Once the user approves the resulting changes, apply them and continue to the next step without asking them to review the updated artifacts again.
