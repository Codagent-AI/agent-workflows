The workflow has finished the CI step of this acceptance round.

- CI status: $INPUTS.ci_status (`not run` means the workflow did not wait for CI, because you reported it was not ready: $INPUTS.ci_reason)
- CI report: `$INPUTS.ci_report` (none when CI was not run)

Finish the pass now by following the instructions below. The report stands in for a CI wait's result: it lists failed checks with their logs, merge conflicts, blocking reviews, actionable PR comments, deferred threads, informational bot comments, passing checks, and checks still running. The script that wrote it did not judge comment meaning. If an informational bot comment says its review of the current head is still pending or in progress, read the pull request's comments again once with `gh pr view --comments`; if that review is still unfinished, treat the status as `pending`, unless failed checks, a conflict or blocking reviews make it `failed`, or actionable feedback makes it `comments`.

## Wait for CI and hand off

If the workflow did not wait for CI, record why in the handoff; the round is not ready. After CI
returns, re-read local `HEAD` and the PR head and require both to match the report's head SHA.

On `failed`, read the failing check's logs; on `comments`, read the comments. Then apply "Before blaming
the environment" before reporting either as external. Add anything attributable to the implementation
to the findings file and report it; report a confirmed external failure as a blocker with its log path
and a short verbatim excerpt rather than a defect. On `pending`, report and stop.
With no configured checks, continue after recording that CI coverage is absent. Treat skipped, neutral,
cancelled, and timed-out checks as evidence states, never as passes.

Then write `<evidence-directory>/acceptance-handoff.md`:

1. **Decision brief**: delivered behavior, unresolved decisions (read the ledger again now; never say none
   are pending without it showing none), overall status, suggested review path.
2. **Revision identity**: repository, PR URL, current head SHA, tracked worktree status.
3. **Exploration**: coverage-floor results, the budget and rationale, what was exercised, what was
   found, and the named list of what was not exercised. For each limitation attributed to a failed run,
   include the evidence path, a short verbatim excerpt of the failing message or warning, and the
   provenance line; give the reason for each item that could not be run.
4. **CI**: status and durable links. Say plainly when no automated-validation evidence was supplied.
5. **Visual and client evidence**: screenshot metadata, text equivalents, and practical review steps.
6. **Human-only obligations**: applicable `HT-*` items as instructions, with no execution outcome.
7. **Assumptions**: the ledger path, then each unresolved decision named by its ledger heading with its
   options and consequence, each material limitation the ledger, findings, or log record, and each risky
   or notable assumption in the implementation session report (`$ARTIFACTS_DIR/session-report.md`), if it exists. A count or a
   pointer alone does not carry a decision.

Before reporting ready, confirm every referenced path exists, that any scratch folder the acceptance
test created was removed, and that no persisted evidence exposes secrets, credentials, or private data. Report
the ready SHA, PR URL, handoff path, unresolved-decision count, CI status, and known limitations.

## Round status

Finally, overwrite `$ARTIFACTS_DIR/acceptance-round-status.txt` with exactly one line. Write `READY <sha>`, where `<sha>` is the full 40-character output of `git rev-parse HEAD`, only when `exploration-log.md` records this pass, `acceptance-tested-revision.txt` and `acceptance-handoff.md` in the evidence directory name that revision, current-head CI passed or is explicitly absent, and no clear defect or impediment remains. Otherwise write `NOT_READY`. The workflow checks this line together with the evidence files to decide whether acceptance testing has converged.

Before your final message, stop every server and other long-running command you started, and confirm none is still running.
