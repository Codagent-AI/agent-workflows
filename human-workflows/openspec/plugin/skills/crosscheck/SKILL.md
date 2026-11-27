---
name: crosscheck
description: Run independent reviews of the code, diff, document, or plan you name, then report checked findings.
disable-model-invocation: true
---

# Crosscheck

1. Use the subject the user named. Write a self-contained review prompt with the subject, scope, relevant context and any review instructions. Include the instructions as text. Strictly tell reviewers to change nothing.
2. Call `crosscheck` once with that prompt. Supply `change_name` only to record the review against a named OpenSpec define in progress. If the tool reports missing configuration or acpx, use the setup skill.
3. While the result is `running`, call `get_crosscheck` with its `crosscheck_id` until it finishes. Use `cancel_crosscheck` with that ID if the user asks to stop.
4. Verify each finding against the relevant source. Combine duplicates, explain confirmed disagreements, and report one combined result. Include every failed reviewer and every changed path the tool reports.
