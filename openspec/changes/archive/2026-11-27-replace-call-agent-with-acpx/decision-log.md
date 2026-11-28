## DECIDE-1: Implement — state write failure after a reviewer batch

- Step: implementation of named crosscheck settlement.
- Question: What should the caller receive if the state file becomes missing, unreadable, or unwritable during the review?
- Requirement: A named crosscheck must record in the define before returning its final status. The batch result reports every reviewer.
- Decision: Attempt the write synchronously before exposing the final status. If the write fails, log `crosscheck_record_failed` and still return the reviewer results, preserving the old tool's behavior when recording fails.
- Alternatives: Refuse the final result and lose the reviews; recreate or overwrite state that may have been changed by the user.
- Rationale: An unavailable state file prevents recording. Preserving the result and logging the failure avoids losing both the state and the answers.
- Evidence: `state-write-failure-inspection.log` shows the previous fallback and current failure logging.
- If wrong: A caller expecting persistence to be guaranteed would have to check the state or event log after an external state-file failure.

Settled in review round 1. Kept the private log as the place to find state-write failures, while preserving the reviewer answers.

## DECIDE-2: Implement — symlinked review instructions

- Step: workflow startup validation.
- Question: Does a filename under `reviews/` count when it is a symlink to a file outside that directory?
- Requirement: A review placeholder must name a plain Markdown filename in the plugin's `reviews/` folder.
- Decision: Resolve the path at startup and require the file to resolve directly within that directory.
- Alternatives: Accept any symlink with an entry in `reviews/`.
- Rationale: The restriction applies to the file that supplies the prompt text, and packaged instructions must come from the plugin.
- Evidence: `check-17.log` exercises a symlink pointing outside the fixture's reviews directory.
- If wrong: A plugin that intentionally ships a link to externally installed review instructions would fail startup.

Settled in review round 1. Kept review instructions confined to the bundled reviews directory.

## DECIDE-3: Implement — checking a killed orphan

- Step: process cleanup verification.
- Question: Does a zombie that the operating system has already stopped count as a surviving reviewer?
- Requirement: Shutdown, cancellation, and timeout must terminate acpx and its descendants. The named test proposes checking survivors with `process.kill(pid, 0)`.
- Decision: Check with signal 0 first, then use `ps` to distinguish a live process from an exited zombie if the PID still exists.
- Alternatives: Treat every extant PID as a survivor, or signal and inspect large sections of the process table beyond the specifically captured PIDs.
- Rationale: A detached child can be reparented to a container PID 1 that leaves its exited PID visible. The plugin can kill the process but cannot reap a process parented elsewhere.
- Evidence: `check-12.log` checks that the fake acpx and its recorded descendants have stopped.
- If wrong: The test could overlook an operating-system reaping problem even though the process can no longer execute.

Settled in review round 1. Kept treating exited zombies as stopped when checking for surviving review processes.

## DECIDE-4: Implement — missing session folder metadata

- Step: MCP entry point for a standalone crosscheck.
- Question: Which folder should a Codex-style call use when the server was started in the installed plugin folder and the call gives no usable session metadata?
- Requirement: The launch folder must be the repository root or the resolved session working folder, and must never be inferred from the server's own installed folder.
- Decision: Refuse with `session_folder_unavailable` when the only fallback is the plugin folder. Explicit session metadata still identifies the session folder.
- Alternatives: Run against the installed plugin folder, or guess from the server's environment.
- Rationale: There is no reliable review target in that request. Guessing could examine unrelated files.
- Evidence: `check-18.log` includes the bundled Codex metadata test which exercises both requests.
- If wrong: A host that starts the bundle in the plugin folder and omits session metadata cannot run crosschecks until it supplies the session folder.

Settled in review round 1. Kept refusing calls without a reliable session folder.

## DECIDE-5: Implement — temp directory resolves inside the working tree

- Step: final review of private log placement.
- Question: Where should the server write review logs if its temp directory resolves inside the repository being reviewed?
- Requirement: Crosscheck logs must stay outside the working tree in a user-private directory under system temp.
- Decision: Resolve the configured log path and use the per-user base under /tmp if that path is inside the working tree. Refuse a launch if both bases resolve inside it.
- Alternatives: Use the configured path as-is, or refuse any call that points at a repository-local temp path.
- Rationale: The fallback preserves both private logging and standalone operation without causing the working-tree check to report the server's own log writes.
- Evidence: `check-16.log` exercises a symlinked temp path into the repository and confirms the log is external and the tree stays clean.
- If wrong: A user who needs logs under a custom temp root would find them under the system fallback when the custom root is inside the review target.

Settled in review round 1. Kept the system temp fallback when the configured log path resolves inside the review target.

## DECIDE-6: Implementation audit — forwarding ACPX_CLAUDE_INCLUDE_USER_SETTINGS under Codex

- Step: audit of the finished implementation.
- Question: Must `.codex-mcp.json` forward `ACPX_CLAUDE_INCLUDE_USER_SETTINGS`, which is not in the design's list of variables?
- Requirement: plugin-packaging, "Codex receives the variables the server needs": list the variables that acpx and the agents it starts need. design.md, "Risks / Trade-offs", tells a user whose Claude sign-in depends on user settings to set this variable. design.md, "Skills, setup and packaging", lists the variables to keep and add and omits it.
- Decision: Add it to `env_vars`. Reported as an audit finding; the audit changed no code.
- Alternatives: Follow the design list exactly, leaving the documented workaround unavailable under a Codex lead.
- Rationale: The spec's requirement covers a variable acpx reads, and Codex passes the server only listed variables. The addition has no effect when the variable is unset.
- If wrong: A Codex user who has the variable set would have Claude reviewers load their user-level Claude settings, hooks included, when the design meant that to work only under other leads.

Settled in review round 1. Kept forwarding the Claude user-settings opt-in to acpx under Codex.

## DECIDE-7: Review finding REVIEW-1, before the pull request: A repository's .acpxrc.json can run any command when a crosscheck starts

- Question: Is this a defect that must be fixed before the change is accepted? Source: a `.acpxrc.json` committed in a cloned repository or contributor branch. Flow: acpxCommand passes `--cwd <repo root>`, and the child also starts there. The installed acpx 0.23.0 `loadResolvedConfig` reads `<cwd>/.acpxrc.json`. Its `agents` entries override global and built-in ones such as `claude` and `codex`, and I found no trust check in its config loader. It can also supply `mcpServers`. Sink: acpx launches the configured command with the lead's environment, including API keys and GITHUB_TOKEN. A user who checks out an untrusted branch and runs a crosscheck on it therefore executes the author's command. This happens before any reviewer or permission decision. The old code launched `claude` or `codex` directly, and loaded no settings or MCP servers for the Claude child. The README says acpx honors repository config but does not warn that this runs commands. (human-workflows/openspec/server/src/acpx.ts:64, high security)
- Requirement: the security review instructions.
- Step: before the pull request review handoff.
- Decision: Declined to fix: The approved design explicitly honors repository acpx configuration and rejects blocking it. An opt-in gate requires a scope decision. The README now warns that repository configuration can launch commands before reviewers read the prompt. The reviewer accepted it.
- Alternatives: fix or leave the finding open.
- What breaks if wrong: Source: a `.acpxrc.json` committed in a cloned repository or contributor branch. Flow: acpxCommand passes `--cwd <repo root>`, and the child also starts there. The installed acpx 0.23.0 `loadResolvedConfig` reads `<cwd>/.acpxrc.json`. Its `agents` entries override global and built-in ones such as `claude` and `codex`, and I found no trust check in its config loader. It can also supply `mcpServers`. Sink: acpx launches the configured command with the lead's environment, including API keys and GITHUB_TOKEN. A user who checks out an untrusted branch and runs a crosscheck on it therefore executes the author's command. This happens before any reviewer or permission decision. The old code launched `claude` or `codex` directly, and loaded no settings or MCP servers for the Claude child. The README says acpx honors repository config but does not warn that this runs commands.
- Rationale: Source: a `.acpxrc.json` committed in a cloned repository or contributor branch. Flow: acpxCommand passes `--cwd <repo root>`, and the child also starts there. The installed acpx 0.23.0 `loadResolvedConfig` reads `<cwd>/.acpxrc.json`. Its `agents` entries override global and built-in ones such as `claude` and `codex`, and I found no trust check in its config loader. It can also supply `mcpServers`. Sink: acpx launches the configured command with the lead's environment, including API keys and GITHUB_TOKEN. A user who checks out an untrusted branch and runs a crosscheck on it therefore executes the author's command. This happens before any reviewer or permission decision. The old code launched `claude` or `codex` directly, and loaded no settings or MCP servers for the Claude child. The README says acpx honors repository config but does not warn that this runs commands.; suggested fix: Before launching, read `join(root, ".acpxrc.json")`. Refuse the crosscheck, naming the file, if it defines `agents`, `mcpServers` or `auth`, or if it cannot be parsed. Allow those keys only after an explicit opt-in stored in the user's own ~/.agent-workflows/config.yaml. Passing explicit `--agent` commands would cover only agent overrides, not repository `mcpServers`. Document the risk.; fixer declined: The approved design explicitly honors repository acpx configuration and rejects blocking it. An opt-in gate requires a scope decision. The README now warns that repository configuration can launch commands before reviewers read the prompt.; reviewer accepted: I checked the decline against the change documents. design.md and proposal.md say repository `.acpxrc.json` files are honored and can replace a reviewer command or add MCP servers. design.md accepts that risk and rejects refusing to run in such repositories, and test-plan.md lists it as an accepted limitation. An opt-in gate would change that scope decision. The new README warning accurately says to use only trusted repositories and checkouts, and that commands can launch before the reviewer reads the prompt. This accepts the decline; the code-execution risk itself remains.. Result: review/before-pr.md

Settled in review round 1. Kept honoring repository acpx configuration as approved, with the README warning about trusted checkouts.

## DECIDE-8: Review finding REVIEW-3, before the pull request: One unreadable file turns off change detection for the whole tree

- Question: Is this a defect that must be fixed before the change is accepted? What can fail: `fileFingerprint` calls lstat, readlink or readFileSync on every dirty or untracked path. A permission-denied file (such as a root-owned container artifact) or a file too large for readFileSync makes it throw. So does a file removed between `git status` and the read. What happens: the single catch around the loop discards the whole snapshot, so compareTrees returns `working_tree: "unknown"`. The gap: a persistent bad file makes every crosscheck lose `changed_paths`, with no cause logged. Reviewers run with --approve-all, so this report is how their writes get noticed. The previous code hashed `<unreadable>` for just that file and kept checking the others. (human-workflows/openspec/server/src/worktree.ts:73, medium error-handling)
- Requirement: the error-handling review instructions.
- Step: before the pull request review handoff.
- Decision: Declined to fix: The approved design requires unknown with no changed paths when either snapshot fails. Substituting metadata for unreadable contents could report unchanged without verifying the file's contents. The reviewer accepted it.
- Alternatives: fix or leave the finding open.
- What breaks if wrong: What can fail: `fileFingerprint` calls lstat, readlink or readFileSync on every dirty or untracked path. A permission-denied file (such as a root-owned container artifact) or a file too large for readFileSync makes it throw. So does a file removed between `git status` and the read. What happens: the single catch around the loop discards the whole snapshot, so compareTrees returns `working_tree: "unknown"`. The gap: a persistent bad file makes every crosscheck lose `changed_paths`, with no cause logged. Reviewers run with --approve-all, so this report is how their writes get noticed. The previous code hashed `<unreadable>` for just that file and kept checking the others.
- Rationale: What can fail: `fileFingerprint` calls lstat, readlink or readFileSync on every dirty or untracked path. A permission-denied file (such as a root-owned container artifact) or a file too large for readFileSync makes it throw. So does a file removed between `git status` and the read. What happens: the single catch around the loop discards the whole snapshot, so compareTrees returns `working_tree: "unknown"`. The gap: a persistent bad file makes every crosscheck lose `changed_paths`, with no cause logged. Reviewers run with --approve-all, so this report is how their writes get noticed. The previous code hashed `<unreadable>` for just that file and kept checking the others.; suggested fix: Handle errors per path. In the loop, set `let print: string; try { print = fileFingerprint(join(options.cwd, path)); } catch (error) { print = `unreadable:${(error as NodeJS.ErrnoException).code}`; }`. For an unreadable file, also include lstat size, mtime and ctime when available so that changes to it still show. Stream large files into the hash instead of loading them with readFileSync.; fixer declined: The approved design requires unknown with no changed paths when either snapshot fails. Substituting metadata for unreadable contents could report unchanged without verifying the file's contents.; reviewer accepted: design.md says that if either snapshot fails, `working_tree` is `unknown` and no paths are listed, and the code does that. The lead sees `unknown`, so the failure is not presented as `unchanged`. The objection to my suggested fix is also fair: matching metadata would not prove that unreadable contents were unchanged.. Result: review/before-pr.md

Settled in review round 1. Kept reporting an unknown working tree when either snapshot fails.

## DECIDE-9: Acceptance — round 0 — whether the 200,000-character cap includes its note

- **Question:** Does “the answer is capped at 200,000 characters with a truncation note” cap the full returned response string, including the note, or only reviewer-authored answer text?
- **Requirement:** openspec/changes/replace-call-agent-with-acpx/specs/crosscheck-review/spec.md, “A reviewer's answer is returned”; design.md, “Reading a reviewer's result”.
- **Reading tested:** A 1,200,000-character ACP message produced a returned reviewer response of 200,042 characters: 200,000 x characters followed by the truncation note. Evidence: acceptance-commands/round-0/21-long-acp-event.txt.
- **Alternatives:** Count the truncation note inside the 200,000-character maximum, shortening reviewer-authored answer text by the note length; or cap reviewer-authored text at 200,000 and append the note, as observed.
- **Rationale:** The spec's “capped at 200,000 characters” can describe the whole returned string; the design's “cut at 200,000 characters with a note” can describe the answer body before adding the note. This remains an ambiguity for human review.
- **What breaks if wrong:** A caller relying on a strict 200,000-character transport limit may receive a response 42 characters over it; capping the note too would reduce the answer body by 42 characters.

Settled in review round 1. Kept the truncation note inside the 200,000-character response cap.

## DECIDE-10: Acceptance triage — round 0 — count the truncation note inside the returned cap

- Step: triage the interpretation question in `acceptance-findings.md` for tested revision `04cb908`.
- Question: Does the 200,000-character limit cover the returned reviewer response or only the reviewer-authored text?
- Requirement: The crosscheck-review spec caps the returned answer at 200,000 characters. The design also requires a truncation note when the answer is cut. The test plan checks a long response cut at the cap with a note.
- Decision: Count the note in the returned response's limit. Keep a response of exactly 200,000 characters intact. When an answer exceeds the limit, reserve enough room for the existing note and return the remaining answer prefix.
- Alternatives: Cap the reviewer-authored body alone and append the note, reproducing the tester's 200,042-character response, or ask the user to choose between the two readings.
- Rationale: The strict limit protects clients that rely on the size of the returned response and still includes the required note. This interpretation fits the approved requirement and needs no change to the definition.
- If wrong: A caller expecting a full 200,000 characters of reviewer-authored text before the note receives 42 fewer characters of the original answer when it exceeds the cap.
- Verification: `evidence/acceptance-fix-0-unit.log` confirms the full response cap and the exact-length boundary. INTEG-2 already drives a long response over the fake acpx subprocess boundary, so its assertion now covers the full length and the note. That integration test was outside this unit-only run. `evidence/acceptance-fix-0-build.log` records the rebuild and bundle comparison.

## DECIDE-11: PR review — Reject repository log directories that resolve inside the checkout

- Step: PR comment fixes.
- Question and requirement: An external log base can contain a hash-named symlink into the tree. The privacy requirement forbids logs in the tree, and the normal external directory and existing base fallback should still work.
- Decision: Validate the resolved repository directory and refuse before creating a batch when the target is inside the checkout.
- Alternatives: Redirect the batch again, or replace the existing entry.
- Rationale: Refusal keeps the existing entry intact and makes the unsafe path visible before any reviewer launches.
- What breaks if wrong: A configuration that intentionally links the repository log directory into the checkout will fail until that path is changed.
- Evidence: `evidence/fix-pr-targeted.log`.

Settled in review round 2. Kept refusing to start a crosscheck when the repository log directory resolves inside the checkout.

## DECIDE-12: PR review — Fingerprint the checked-out commit of dirty gitlinks

- Step: PR comment fixes.
- Question and requirement: The tree result needs to distinguish changes to the checked-out revision when both snapshots have the same index entry and dirty status.
- Decision: Include the initialized submodule HEAD in the path fingerprint. Keep the directory fingerprint for uninitialized submodules and the established unknown result if resolving an initialized HEAD fails.
- Alternatives: Compare only the gitlink in the parent index, or fingerprint files recursively inside every submodule.
- Rationale: The checked-out revision identifies this change without adding a separate recursive review scope.
- What breaks if wrong: A damaged initialized submodule whose HEAD cannot be read makes the snapshot unknown.
- Evidence: `evidence/fix-pr-targeted.log`.

Settled in review round 2. Recorded a follow-up to detect further edits inside an already-dirty submodule. The follow-up should cover tracked and untracked file changes when the checked-out commit, parent gitlink, and dirty status stay the same. Verify that the result identifies the affected submodule or reports that it could not determine the change. This pull request keeps the checked-out commit fingerprint. It can still miss further changes inside an already-dirty submodule.

## DECIDE-13: PR review — Report denied process-group signals

- Step: PR comment fixes.
- Question and requirement: The cleanup design signals groups that still exist. A failed signal-zero probe can mean the group exists but the server lacks permission.
- Decision: Treat ESRCH as absence. Keep escalation armed on other probe errors and log non-ESRCH failures to server stderr without replacing the reviewer outcome.
- Alternatives: Treat every error as absence, or add a new reviewer outcome for cleanup diagnostics.
- Rationale: Permission failures stay visible and the existing cancellation and timeout result schema remains intact.
- What breaks if wrong: A group the server cannot signal can still survive, with the failure visible in server stderr.
- Evidence: `evidence/fix-pr-targeted.log`.

Settled in review round 2. Kept reporting denied process-group signals to server stderr without adding a cleanup warning to the crosscheck result.

## DECIDE-14: Review finding REVIEW-7, feedback round 3: Edits inside an already-dirty submodule are reported as unchanged

- Question: Is this a defect that must be fixed before the change is accepted? Precondition: a submodule already shows ` M` when the crosscheck starts, because its HEAD has moved or it has uncommitted edits. During the review, something edits or adds files inside it without committing.

Trace: the parent's `git status --porcelain=v1` still shows ` M nested`, and the gitlink index entry is the same. For the directory, `fileFingerprint` hashes only its mode and the value from `submoduleHead`. Neither changes.

Failure: `compareTrees` returns `unchanged` although the reviewer changed files in the checkout. That answer is returned to the caller and saved in the define state. It should be `changed` or `unknown`. In a temporary repo, the parent status, index entry and submodule HEAD were identical before and after a second edit and a new untracked file inside an already-dirty submodule. The new `addDirtySubmodule` tests cover an untouched submodule and a HEAD advance, but not a content-only change. (human-workflows/openspec/server/src/worktree.ts:65, medium quality)
- Requirement: the quality review instructions.
- Step: feedback round 3 review handoff.
- Decision: Declined to fix: Confirmed that edits inside an already-dirty submodule can be missed when its HEAD and dirty status stay the same. The reviewer chose to record this exact gap as a follow-up and keep it out of this PR. The reviewer accepted it.
- Alternatives: fix or leave the finding open.
- What breaks if wrong: Precondition: a submodule already shows ` M` when the crosscheck starts, because its HEAD has moved or it has uncommitted edits. During the review, something edits or adds files inside it without committing.

Trace: the parent's `git status --porcelain=v1` still shows ` M nested`, and the gitlink index entry is the same. For the directory, `fileFingerprint` hashes only its mode and the value from `submoduleHead`. Neither changes.

Failure: `compareTrees` returns `unchanged` although the reviewer changed files in the checkout. That answer is returned to the caller and saved in the define state. It should be `changed` or `unknown`. In a temporary repo, the parent status, index entry and submodule HEAD were identical before and after a second edit and a new untracked file inside an already-dirty submodule. The new `addDirtySubmodule` tests cover an untouched submodule and a HEAD advance, but not a content-only change.
- Rationale: Precondition: a submodule already shows ` M` when the crosscheck starts, because its HEAD has moved or it has uncommitted edits. During the review, something edits or adds files inside it without committing.

Trace: the parent's `git status --porcelain=v1` still shows ` M nested`, and the gitlink index entry is the same. For the directory, `fileFingerprint` hashes only its mode and the value from `submoduleHead`. Neither changes.

Failure: `compareTrees` returns `unchanged` although the reviewer changed files in the checkout. That answer is returned to the caller and saved in the define state. It should be `changed` or `unknown`. In a temporary repo, the parent status, index entry and submodule HEAD were identical before and after a second edit and a new untracked file inside an already-dirty submodule. The new `addDirtySubmodule` tests cover an untouched submodule and a HEAD advance, but not a content-only change.; suggested fix: Fingerprint the submodule's working tree as well as its HEAD, using the same snapshot logic recursively:

async function submoduleState(path: string, options: RunOptions): Promise<string> {
  if (!lstatSync(join(path, ".git"), { throwIfNoEntry: false })) {
    return "";
  }
  const inner = await snapshotTree({ ...options, cwd: path });
  if (!inner) {
    throw new Error(`Could not snapshot submodule at ${path}`);
  }
  return JSON.stringify([inner.head, [...inner.paths].sort(([a], [b]) => a.localeCompare(b))]);
}

In the gitlink branch, call `hash.update(await submoduleState(path, options))`. Add a test case that starts with a dirty submodule, changes a file inside it without committing, and expects `["nested"]`.; fixer declined: Confirmed that edits inside an already-dirty submodule can be missed when its HEAD and dirty status stay the same. The reviewer chose to record this exact gap as a follow-up and keep it out of this PR.; reviewer accepted: The gap is still there: further uncommitted edits inside an already-dirty submodule can be reported as `unchanged`. The decline is a deliberate scope decision, and the record supports it. Line 146 of the change's decision-log.md says review round 2 settled this exact gap as a follow-up. It covers tracked and untracked edits when the submodule commit, parent gitlink and dirty status stay the same. It also says this PR keeps only the commit fingerprint and can still miss these edits. The follow-up requires the result to name the affected submodule or report that the change couldn't be determined. The same entry shows that recursive fingerprinting was considered as an alternative and left out.. Result: review/feedback.md
