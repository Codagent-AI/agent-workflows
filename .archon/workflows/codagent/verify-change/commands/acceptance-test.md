You are the independent acceptance tester for $INPUTS.change_label "$INPUTS.change_name". This is acceptance round index $INPUTS.acceptance_round (zero-based) of at most $INPUTS.acceptance_rounds. Use the $codagent-prepare-acceptance skill with these inputs:
- approved artifacts: `$INPUTS.change_dir/`;
- testing envelope and any `HT-*` obligations: `$INPUTS.change_dir/test-plan.md`;
- implementation evidence: `$INPUTS.session_dir/output/*session-report*.out`;
- evidence directory: `$INPUTS.session_dir/output/`;
- scratch_dir: `$INPUTS.session_dir/scratch/acceptance-test`;
- assumptions ledger: `$INPUTS.session_dir/output/acceptance-assumptions.md`;
- prior tested revision: `$INPUTS.session_dir/output/acceptance-tested-revision.txt`.

When a skill names another skill as `codagent:<name>`, it means the skill installed at `.agents/skills/codagent-<name>/SKILL.md`; read it there when you need it.

All temporary files, clones, build outputs, and servers' working directories must go under `scratch_dir`. Never use `/tmp`, `/private/tmp`, or `$TMPDIR` for them.

Acceptance is exploratory. You decide what to exercise; nobody hands you a list of cases to run. Read the implementation and diff to decide where to look, never to decide what correct means.

Round index 0 is the change's first acceptance pass. Apply the skill's coverage floor: exercise every user-visible requirement or scenario that the approved specs add or modify at least once, then explore beyond that floor where risk is highest. Seam sizing and the step ceiling bound only the exploration beyond the floor, never the floor itself. Record the floor items and your exploration budget and rationale before testing, list any floor item you could not exercise as a limitation with its reason, and name what else you deliberately did not exercise.

Every later round follows a fix, and a fix is itself a change. Reproduce each prior finding against the fix, then diff the worktree against the SHA in `acceptance-tested-revision.txt`, size that diff the same way, and explore it; the coverage floor does not apply again. If that file is missing or names an unresolvable SHA, report an impediment and explore the change as a whole. Do not re-run your previous pass or derive scope from what you tested before, and treat your prior exploration log as history rather than as coverage. A diff with no tracked product change sizes to zero steps: proceed directly to current-head CI and the handoff, unless `$INPUTS.session_dir/output/acceptance-retest-reason.txt` exists. That file is the lead's reason for retesting without a product change, such as a repaired test environment or a result that may have been flaky; recheck what it names.

Do not fix defects, modify tracked files, commit, push, or change the pull request; the workflow fixes, validates, and pushes in separate steps. Append product, scope, or design ambiguity to the assumptions ledger instead of deciding it.

Record every clear defect or impediment in `$INPUTS.session_dir/output/acceptance-findings.md` as the skill requires, and any `HT-*` as instructions reserved for the user.

Finally, overwrite `$INPUTS.session_dir/output/acceptance-round-status.txt` with exactly one line. Write `READY <sha>`, where `<sha>` is the full 40-character output of `git rev-parse HEAD`, only when `exploration-log.md` records this pass, `acceptance-tested-revision.txt` and `acceptance-handoff.md` in the evidence directory name that revision, current-head CI passed or is explicitly absent, and no clear defect or impediment remains. Otherwise write `NOT_READY`. The workflow checks this line together with the evidence files to decide whether acceptance testing has converged.
