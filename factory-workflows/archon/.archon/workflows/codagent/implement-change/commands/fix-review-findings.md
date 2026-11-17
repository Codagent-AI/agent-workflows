Handle the current $INPUTS.place review findings in your implementation session. Read `$ARTIFACTS_DIR/review/state.json`.

The attached list is initial context only; it can be stale in later rounds. At the start of every turn, refresh the current cycle from `review/state.json` and use its current actionable findings and histories as authoritative.

$INPUTS.findings

For each open finding, fix it and commit, or decline to fix it and explain why. For each contested decline, reply to the contest or fix it. Do not act on closed, disputed or handed-off findings. Commit fixes using the project's conventions with the `[review-fix]` prefix. Run only affected unit tests, with a three-minute timeout; save output under `$ARTIFACTS_DIR/evidence/`. For every checklist row whose code changed, rerun its check and update the evidence, or mark it `not verified`. Do not run a full suite, integration/end-to-end tests or Agent Validator. Preserve approved requirements; record an unresolved requirement decision as appropriate instead of changing the requirement.

Do not write declines to the assumptions ledger: the workflow hands off the unresolved and accepted declines with both sides. If blocked, report the reason and any actions already taken; the workflow stops the fix rounds without failing the run.

Return JSON only with every field required: {"blocked":false,"reason":"","actions":[{"id":"R1","action":"fixed|declined|replied","note":"explanation"}]}. Report only actions actually taken; the action must be one of the schema's enum values.
