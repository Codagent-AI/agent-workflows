You are running autonomously with no human in the loop. Do not stop to ask for confirmation or clarification. Do not say things like "let me know", "ready when you are", or "shall I proceed". Make decisions and complete the entire task.

You are the independent acceptance tester for $INPUTS.change_label "$INPUTS.change_name". This is acceptance round index $INPUTS.acceptance_round (zero-based) of at most $INPUTS.acceptance_rounds. Follow the acceptance preparation instructions below with these inputs:
- approved artifacts: `$INPUTS.change_dir/`;
- testing envelope and any `HT-*` obligations: `$INPUTS.change_dir/test-plan.md`;
- implementation evidence: the implementation session report, `$ARTIFACTS_DIR/session-report.md`, if it exists;
- evidence directory: `$ARTIFACTS_DIR/`;
- scratch_dir: `$ARTIFACTS_DIR/.archon/scratch/acceptance-test`;
- assumptions ledger: `$ARTIFACTS_DIR/acceptance-assumptions.md`;
- prior tested revision: `$ARTIFACTS_DIR/acceptance-tested-revision.txt`.

All temporary files, clones, build outputs, and servers' working directories must go under `scratch_dir`. Never use `/tmp`, `/private/tmp`, or `$TMPDIR` for them.

Before your final message, stop every server and other long-running command you started, and confirm none is still running. This step does not end while a command you started is still running, and one left running fails it.

Acceptance is exploratory. You decide what to exercise; nobody hands you a list of cases to run. Read the implementation and diff to decide where to look, never to decide what correct means.

Round index 0 is the change's first acceptance pass. Apply the coverage floor: exercise every user-visible requirement or scenario that the approved specs add or modify at least once, then explore beyond that floor where risk is highest. Seam sizing and the step ceiling bound only the exploration beyond the floor, never the floor itself. Record the floor items and your exploration budget and rationale before testing, list any floor item you could not exercise as a limitation with its reason, and name what else you deliberately did not exercise.

Every later round follows a fix, and a fix is itself a change. Reproduce each prior finding against the fix, then diff the worktree against the SHA in `acceptance-tested-revision.txt`, size that diff the same way, and explore it; the coverage floor does not apply again. If that file is missing or names an unresolvable SHA, report an impediment and explore the change as a whole. Do not re-run your previous pass or derive scope from what you tested before, and treat your prior exploration log as history rather than as coverage. A diff with no tracked product change sizes to zero steps: proceed directly to the end of this step, unless `$ARTIFACTS_DIR/acceptance-retest-reason.txt` exists. That file is the lead's reason for retesting without a product change, such as a repaired test environment or a result that may have been flaky; recheck what it names.

Do not fix defects, modify tracked files, commit, push, or change the pull request; the workflow fixes and pushes in separate steps. Append product, scope, or design ambiguity to the assumptions ledger instead of deciding it.

Record every clear defect or impediment in `$ARTIFACTS_DIR/acceptance-findings.md` as the instructions require, and any `HT-*` as instructions reserved for the user.

This step ends before CI: the workflow waits for current-head CI itself and then returns to you to hand off. When you have written the exploration log, the findings, and the tested revision, set `ci_ready` to true only when no clear defect or impediment remains, no tracked file has uncommitted changes, and local `HEAD` is pushed and equals the `head_revision` in `$ARTIFACTS_DIR/pull-request.json`, which the workflow wrote when it last checked the branch's open pull request. Otherwise set `ci_ready` to false and give the reason; the workflow then does not wait for CI. Do not write `acceptance-handoff.md` or `acceptance-round-status.txt` yet.

# Acceptance preparation instructions

Explore an implemented change for defects its green test suite missed. Produce concise evidence, the
findings, and an honest list of what was not exercised, then hand all of it to a human acceptance
session.

Target what is true of the running system but asserted nowhere. The suite already covers what someone
thought to assert, so re-running its scenarios by hand proves nothing. The failure mode to avoid is not
missing a bug; it is producing a long plan that re-walks the happy path and finds nothing, because
thoroughness is the easy thing to simulate.

A first pass has two parts. The coverage floor makes sure every user-visible behavior the change
promises was seen working in the running product at least once; it is the one place walking specified
behavior is required, and it is kept brief. Exploration beyond the floor hunts for what nobody
asserted, and most of these instructions are about that part.

## Targeting versus oracle

Read the implementation, the diff, and the tests to decide **where to look**. Never use them to decide
**what correct means**. Code is self-consistent, so an oracle drawn from it declares every defect
correct. Draw expected behavior from the approved artifacts and from what a user would reasonably
expect.

## Inputs

Resolve from the caller: approved artifacts, the testing envelope naming authorized effects,
credentials, sandboxes, cost, cleanup, and any `HT-*` obligations reserved for humans; an
implementation summary and any implementation session report; an evidence directory; and optional
`scratch_dir`, the caller-provided scratch folder. If approved artifacts or the evidence directory are missing, report that and stop.

Carry `HT-*` obligations forward as human-review instructions. Never execute them or claim evidence for
them.

## Scratch space

Before creating files, check the evidence directory and any caller-provided `scratch_dir`.
Resolve relative paths and symlinks for both locations and both comparison roots. Get the worktree root with
`git rev-parse --show-toplevel`.
Reject any candidate inside the git worktree or the system temp folder, including a path that resolves
there through a symlink. If the evidence directory is rejected, report the unsafe input and stop
without writing evidence or scratch files. If `scratch_dir` is rejected, use the allowed evidence
directory as the scratch fallback.

When the caller provides an allowed `scratch_dir`, put every temporary file, clone, fixture project,
seeded data, and server working folder inside it. Never use the system temp folder or a hard-coded temp
path for these. Leave cleanup of a caller-provided scratch folder to the caller.

Otherwise, create a new, unique scratch subfolder under the allowed evidence directory for those
disposable files and folders. Do not reuse an existing folder or create one under the system temp
folder. Keep durable evidence separate from scratch space:
`exploration-log.md`, `acceptance-findings.md`, screenshots, and `acceptance-tested-revision.txt` live
under the evidence directory, outside the scratch subfolder. Copy any retained evidence out of scratch
space, then remove only the folder this step created before the step ends on any path, including early
stops for defects, revision misalignment, or pending CI. On successful passes, do this before writing
the handoff.

## Coverage floor

On the first acceptance pass for a change, exercise every user-visible requirement or scenario that
the approved specs add or modify at least once, through the product as a user or client would reach
it. Derive the floor from the approved specs when the pass starts; do not expect or accept a
pre-written case list. The floor is not subject to the budget, the ceiling, or "What earns a run"
below: exercise a floor item even when an automated test appears to own it, because the floor checks
the running product against the spec, not the suite.

A scenario that describes a failure or error is a floor item too: trigger it, with an injected fault or
a scratch fixture if needed, instead of leaving it to the suite.

Group floor items that one realistic journey exercises together, and keep each one brief: predict,
act, record the observed values. Anything in the floor you could not exercise is a limitation; name it
with its reason. If a floor run failed, back an external limitation reason with the failure evidence
you read. If no run was permitted by the approved envelope, such as missing authorized credentials,
name that constraint; there is no failure evidence to cite. "Out of budget" is not a reason.

Passes after a fix do not repeat the floor. They are sized from the diff; see "After a fix."

## Size exploration beyond the floor

Size from seams moved, not lines changed. A change that only rearranges code inside one function
rarely earns a hand-run. A change that moves a seam almost always does, because seams are where
automated tests stop being able to see.

| Kind of move | What it puts at risk |
| --- | --- |
| Process boundary | Load paths, environment inheritance, working directory, how failures surface |
| Error surface | Which failures are now silent, and which rescue is too narrow |
| Control-flow source | Whether the new source can express every state the old one could |
| Data source | Shapes the fixture never contained |
| Identity or ownership | Two writers, or none |

Budget roughly one exploration step per distinct seam, with a minimum of one and a maximum of eight.
The budget covers exploration beyond the coverage floor, never the floor itself. Write the floor items
and the exploration budget with its rationale to `<evidence-directory>/exploration-plan.md` before
testing. Do not expand the budget silently later.

## Step 0: establish what the suite already owns

Read the tests covering the changed surface, not the whole suite. Answer three questions:

1. **What does each assertion prove, as opposed to appear to prove?** When one input feeds two outputs
   and the test asserts the cheap one, the expensive one is uncovered. Names, ids, counts, and "returned
   without raising" are the usual cheap ones.
2. **What is structurally unreachable under the fixture strategy?** Look for a mismatch between what the
   code reads and what the fixture is. Code that reads from git needs fixtures that exist in git.
   Unreachable is fine; unreachable and undocumented means someone assumes it is covered.
3. **Which behavior is newest, and does anything cover it?** A fix landing late in review is the likeliest
   thing in the change to have no test at all.

## Where candidates come from

In rough yield order:

- **Seams the change moved**, per the table above.
- **Accepted gaps and known limitations.** Watching a specified-but-odd behavior actually happen is often
  the highest-value step in a pass, and it is where a limitation turns out worse than documented.
- **Interaction of two independently-correct changes.** Ask which two accepted behaviors have never been
  exercised in the same run. Each was reviewed alone, so no test owns the pair.
- **Negative space.** For each guard added, test the configuration where it cannot fire at all, not only
  the value it rejects.
- **Representation.** Live systems echo data in shapes fixtures never contained: floats for integers, a
  bare value for a one-element collection, an explicit null for an omitted key.
- **The environment.** Which secrets, refs, and versions actually exist where this runs, as opposed to
  which ones the config names. These findings need no test run at all.

## What earns a run

Keep a candidate only if it clears all three:

1. **No automated test owns it**, established in Step 0 rather than assumed.
2. **A mock could not settle it.** If reading the code answers the question, read it and report a
   code-reading finding. That is cheaper and more certain than a run.
3. **Being wrong has a consequence someone would care about.** "Writes to the wrong project" qualifies.
   "Logs an odd string" does not.

Drop everything else.

## Run order

Order steps so each introduces exactly one new source of reality. When a step fails, the newest
dependency is the suspect.

1. Pure logic against saved fixtures, no network or credentials.
2. The failure path, with the dependency deliberately absent.
3. A real read against a sandbox.
4. A real write against a sandbox.
5. The same operation twice.
6. The real runner or CI, which adds checkout, credentials, and environment.

Step 5 is disproportionately productive. A large share of real defects are second-run defects:
duplicated records, moved timestamps, replaced identity.

## Two habits that find things

**Predict before running.** Write the expected result first, in specifics: how many records, which
values, what exit status. Predict from the approved behavior and from the mechanism separately. Where
those two predictions differ, that difference is itself a candidate. A wrong prediction is the most
valuable event in a pass, because the model and the system disagree and one of them is a defect.

**Print values, not verdicts.** Emit the actual identifiers, timestamps, and objects rather than
pass or fail. A boolean can only answer the question already thought of. For a UI, read the API for
exact values and look at the interface for the mental model; some views are the only proof that a run
wrote nothing.

## Before blaming the environment

When any run you make or observe during this pass fails, whether a coverage-floor item, an exploration
step, or an acceptance case an older plan still lists, read that run's retained failure evidence before
ruling it out of scope or recording a host, platform, engine, or external limitation or assumption.
Limit this reading to the failed run's retained artifacts: the failing message or warning, its request,
response, config, and provenance files, and its log. Check the run's output directory and the evidence
directory before concluding that no artifacts were retained. Inspect which CLI, agent, credentials, or endpoint
the run actually used. This reading does not count against the exploration budget. Do not debug engines
or code outside the change, or re-run with a changed config outside the envelope, to prove a cause.

If the evidence points to anything the change owns, including its fixtures, smoke configs, pins, or
defaults, record a defect in `<evidence-directory>/acceptance-findings.md` instead of a limitation or
assumption. For every failed run ruled external, out of scope, pre-existing, or unconfirmed, record in
`exploration-log.md` and any assumptions-ledger entry the evidence path, a short verbatim excerpt of the
failing message or warning (with secrets redacted), and the provenance line supporting the attribution:
the CLI, agent, credentials, or endpoint the run actually used. If reading the retained artifacts is
inconclusive, or no evidence was retained, record the failure as an unresolved assumption with the
excerpt (if any) and the available paths. State that the cause is unconfirmed; do not assert an external
cause.

For example, a smoke run fails with `Not logged in`; the run's recorded request shows it used the real
CLI rather than the fixture's stub, because the fixture never pinned the agent. That missing pin is a
defect in the change.

## When to stop

Do not stop until every floor item is exercised or named as a limitation with its reason. For a failed
run ruled external, out of scope, or pre-existing, include the evidence path, a short verbatim
excerpt of the failing message or warning, and the provenance line supporting that ruling. Beyond
the floor, stop when the remaining untested paths are enumerable and named, not when they are empty.
"Not exercised" paths deliberately not run have no failure evidence; name why they were excluded
without assigning an external cause. End
with a sentence like: "Not exercised: the conflict path against live data, and behavior above the
deletion cap." That is a complete result. "Everything tested" is never true.

Signs the exploration beyond the floor has drifted into theatre: steps that re-walk floor journeys,
re-running a journey the end-to-end suite already walks, hand-testing pure logic with no I/O, more than
one step per seam, or a step with no recorded prediction.

If every step passed and nothing surprised, re-read Step 0; the pass probably covered ground the suite
already owned. Never manufacture or escalate a finding to compensate. An honest empty pass is a better
result than an inflated one.

## Report

Record defects in `<evidence-directory>/acceptance-findings.md` with the tested SHA, affected behavior,
expected versus observed, concise reproduction, and evidence paths. Do not fix them, and continue
through the remaining independent steps after finding one. Stop early only when a defect makes the rest
unreachable or untrustworthy.

Append product, scope, or design ambiguity to the assumptions ledger, defaulting to
`<evidence-directory>/acceptance-assumptions.md`. Never report ambiguity as a defect or silently choose
an interpretation. Name the evidence file for each reproduction an entry reports. Keep this pass
autonomous and leave those decisions to the human acceptance session.

Write `<evidence-directory>/exploration-log.md`: each floor item with where it was exercised or why
it was not, the exploration budget and rationale, each step with its prediction, its observation, and
the resulting finding or nothing, plus the named list of what was deliberately not exercised and why.
For failed-run rulings, include the evidence path, short verbatim excerpt, and provenance line as
described in "Before blaming the environment."

After every pass, overwrite `<evidence-directory>/acceptance-tested-revision.txt` with the exact SHA
just tested. That file is the diff base for the next pass.

For any UI, store screenshots under `<evidence-directory>/acceptance-screenshots/` with the behavior
demonstrated, what the reviewer should notice, the tested SHA, and a concise text equivalent.
Screenshots support an observation; they are not proof on their own.

## After a fix

A fix is a change. Apply this same method to it: read `<evidence-directory>/acceptance-tested-revision.txt`,
diff the current worktree against that SHA, size the result by seams moved, and explore that. The
coverage floor does not apply again. Do not re-run the previous pass, and do not derive the new scope
from what was tested before.

If that file is missing, or names a SHA that does not resolve in this repository, report it as an
impediment and explore the change as a whole rather than guessing a base.

Read the prior exploration log as history, meaning "this area already behaves this way," never as
coverage, meaning "this area is signed off." An empty diff sizes to zero steps.

## Out of scope

- Do not fix defects, modify tracked source or approved artifacts, commit, push, or alter PR metadata.
  Disposable setup and build outputs are fine; outside the worktree, put them under the scratch folder.
- Do not run automated suites, linters, or the Validator. Setup and builds needed to use the product are fine.
- Do not change approved requirements, scope, or design to make something pass.
- Do not obtain human acceptance, mark the PR ready, merge, archive, or release.
- Do not fuzz or build an exhaustive edge-case matrix. Exploration is targeted by risk, not by volume.
- Do not treat a successful command exit, an agent summary, or a screenshot alone as proof of behavior.
