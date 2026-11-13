# draft-pull-request Specification

## Purpose
Defines how the pack reaches the forge, opens and keeps the change's pull request as a draft, publishes its description, and reports CI and review state for each acceptance round.

## Requirements

### Requirement: Forge access is checked before any agent spends
The first node after input validation SHALL check that a forge plugin serves the host of the branch's remote with every operation the pack uses, and that its credential resolves, without calling the forge.

#### Scenario: Plugin and credential are ready
- **WHEN** `archon forge check` reports a plugin and a credential for the remote's host
- **THEN** the node passes and prints the plugin, its version, the host and the credential source

#### Scenario: Remote has no usable host
- **WHEN** the branch's remote has no URL, or no host can be read from it
- **THEN** the run fails before any agent node runs

#### Scenario: CLI argv is missing
- **WHEN** `ARCHON_CLI_COMMAND` is not a JSON array of strings
- **THEN** the node fails naming the variable

### Requirement: Forge calls go through the Archon forge CLI
Every pull request read and write except comment threads SHALL run as `archon forge <op> --data-file <file>`, with authored content only in the data file.

#### Scenario: Failed read
- **WHEN** the envelope has `ok: false`
- **THEN** the check fails with the operation and the error kind and message

#### Scenario: Write is refused or unverified
- **WHEN** a write's `mutation.outcome` is `refused`, `verification_failed` or `outcome_unknown`
- **THEN** the check fails with that outcome, and names anything the forge may have left behind

#### Scenario: Audit not persisted
- **WHEN** the CLI exits with status 2
- **THEN** the check fails saying the run audit was not persisted and to check the forge before retrying

#### Scenario: No envelope
- **WHEN** the CLI prints no JSON envelope
- **THEN** the check fails with the exit status and stderr

### Requirement: Agents push and write files
Agents SHALL push with `git` and write the pull request's title and description to files.

#### Scenario: Agent opens the draft
- **WHEN** `open-draft-pr` ends
- **THEN** `pr-title.txt` and `pr-body.md` hold the title and the description, and no agent has created or edited a pull request

#### Scenario: Lead cannot push
- **WHEN** the lead is blocked by a missing credential or a decision only a human can make
- **THEN** it reports `blocked` with the reason, and the publish step fails with `REPAIR_BLOCKED: <reason>`

### Requirement: The pack opens or updates the pull request from the files
The pack SHALL open or update the pull request from the title and description files.

#### Scenario: Pack publishes
- **WHEN** `pr-title.txt` and `pr-body.md` exist
- **THEN** a script node creates or updates the pull request from them

### Requirement: A new pull request opens as a draft on the default branch
When the branch has no open pull request, the workflow SHALL create one as a draft against the remote's default branch, with the generated description as its body.

#### Scenario: No pull request exists
- **WHEN** the branch has no open pull request and the title file is not empty
- **THEN** a draft pull request is created with the title, the default branch as base, and the description between the generated-body markers

#### Scenario: Title is empty
- **WHEN** the pull request must be created and the title is empty
- **THEN** the step fails saying the title is missing or empty

#### Scenario: Default branch unknown
- **WHEN** the remote's default branch cannot be read
- **THEN** the step fails naming the remote

### Requirement: An existing pull request keeps what a human added
When the branch already has an open pull request, the workflow SHALL replace only the generated block of its body.

#### Scenario: Body has markers
- **WHEN** the body holds the start and end markers in order
- **THEN** only the text from the start marker through the end marker is replaced

#### Scenario: Body has no markers
- **WHEN** the body has no ordered markers
- **THEN** the generated block is placed before the old body

### Requirement: An existing pull request stays a draft
When the branch already has an open pull request, the workflow SHALL keep it a draft.

#### Scenario: Pull request had been marked ready
- **WHEN** the open pull request is not a draft when its body is updated
- **THEN** it is converted back to a draft

### Requirement: The description must be publishable
The workflow SHALL fail when the description is missing, empty or contains a body marker.

#### Scenario: Description contains a marker
- **WHEN** `pr-body.md` contains a start or end marker
- **THEN** the step fails because the workflow adds the markers

#### Scenario: Description file is missing
- **WHEN** `pr-body.md` is missing or empty
- **THEN** the step fails naming the file

### Requirement: The pull request matches the local head
The workflow SHALL check that the branch has exactly one open draft pull request with a base branch whose head revision is local `HEAD`.

#### Scenario: Pull request matches
- **WHEN** the pull request is open, a draft, has a base, and its head equals local `HEAD`
- **THEN** the check passes, prints the URL and writes the URL, number, branch, base, draft state and head revision

#### Scenario: Forge lags behind a push
- **WHEN** the head does not match on the first attempt
- **THEN** the check reads again up to the configured attempts, the configured seconds apart, before it fails

#### Scenario: Detached head or none found
- **WHEN** `HEAD` is detached or the branch has no open pull request
- **THEN** the check fails saying so, and one lead repair runs

### Requirement: The matching pull request is recorded
The workflow SHALL record the pull request it found in `pull-request.json`.

#### Scenario: Record written
- **WHEN** the check passes
- **THEN** `pull-request.json` holds the URL, number, branch, base, draft state and head revision

### Requirement: The pull request is converted back to a draft after each push
After an acceptance push, the workflow SHALL convert the pull request back to a draft.

#### Scenario: Pull request was marked ready
- **WHEN** the pull request is not a draft after a push
- **THEN** the draft step converts it and the check passes

#### Scenario: Forge refuses the conversion
- **WHEN** the forge refuses the draft operation
- **THEN** the run fails, because no agent can resolve it

### Requirement: The pull request is checked again after the push
After an acceptance push, the workflow SHALL check the pull request again.

#### Scenario: Pull request does not match after the push
- **WHEN** the check still fails after ten attempts
- **THEN** one lead repair runs in the fix session, and a second failure fails the run

### Requirement: The CI wait is bounded
The wait SHALL poll the pull request's checks, reviews and merge state every 30 seconds for up to 15 minutes.

#### Scenario: No checks exist
- **WHEN** the pull request has no checks
- **THEN** the wait polls until the deadline, and the report says no CI checks are configured

#### Scenario: Deadline passes
- **WHEN** checks are still pending after 15 minutes
- **THEN** polling ends and the status is `pending`

### Requirement: The CI wait ends early when the outcome is settled
The wait SHALL stop earlier when polling again cannot change the outcome.

#### Scenario: All checks pass
- **WHEN** at least one check exists, all have passed, and the merge state is known
- **THEN** polling ends before the deadline

#### Scenario: A check fails
- **WHEN** a check has failed, a review requests changes, or the merge state is `conflict`
- **THEN** polling ends at once

### Requirement: A failed forge read ends the wait with an error
The wait SHALL report status `error` with the problem when a forge read fails.

#### Scenario: Forge read fails
- **WHEN** a read of checks, reviews, merge state or comments fails, or no pull request is found
- **THEN** the status is `error` with the problem

### Requirement: CI status follows a fixed precedence
The final status SHALL be `failed` when a check failed, a review requests changes or the pull request conflicts, else `comments` when there is actionable feedback, else `pending` when a check is unfinished or the merge state is unknown, else `passed`.

#### Scenario: Failed beats comments
- **WHEN** a check failed and an unresolved thread exists
- **THEN** the status is `failed`

#### Scenario: Unclassified check
- **WHEN** a check is gated, unknown or otherwise neither green nor red
- **THEN** it counts as pending and not as passed

#### Scenario: Latest review per reviewer
- **WHEN** a reviewer requested changes and then approved
- **THEN** that reviewer does not block

### Requirement: The CI report gives the tester evidence to judge
The wait SHALL write `ci/round-<n>.md` with the status, the pull request, the head, the failed checks' log tails, conflicting files, blocking reviews, comments and check lists.

#### Scenario: Failed check
- **WHEN** a check failed
- **THEN** the report holds the last 100 lines of its log, for at most the first ten failed checks

#### Scenario: Head moved
- **WHEN** local `HEAD` or the pull request head differs from the head the checks were read for
- **THEN** `head_moved` is true and the report says so

### Requirement: Comments are read with one GraphQL query
The wait SHALL read review threads and conversation comments with one `gh` GraphQL query.

#### Scenario: More than one page
- **WHEN** the pull request has over 100 review threads or conversation comments
- **THEN** the status is `error` telling a human to read them on GitHub

### Requirement: Unresolved threads and human comments are actionable feedback
The wait SHALL count unresolved threads and human conversation comments as actionable feedback.

#### Scenario: Thread answered by the author
- **WHEN** the latest significant comment of an unresolved thread is from the pull request's author
- **THEN** the thread is deferred and does not count as feedback

#### Scenario: Bot comment
- **WHEN** a top-level comment is from an author whose type is `Bot`
- **THEN** it is listed as informational and does not count as feedback
