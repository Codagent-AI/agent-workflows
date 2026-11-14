## ADDED Requirements

### Requirement: Agents push and write the pull request files
Agents SHALL push with `git` and write the pull request's title and description to files.

#### Scenario: Agent opens the draft
- **WHEN** `open-draft-pr` ends
- **THEN** `pr-title.txt` and `pr-body.md` hold the title and the description, and no agent has created or edited a pull request

#### Scenario: Implementor cannot push
- **WHEN** the implementor is blocked by a missing credential or a decision only a human can make
- **THEN** it reports `blocked` with the reason, and the publish step fails with `REPAIR_BLOCKED: <reason>`

## MODIFIED Requirements

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
- **THEN** the check fails saying so, and one implementor repair runs, continuing the pull request step's session

### Requirement: The pull request is checked again after the push
After an acceptance push, the workflow SHALL check the pull request again.

#### Scenario: Pull request does not match after the push
- **WHEN** the check still fails after ten attempts
- **THEN** one implementor repair runs in the fix session, and a second failure fails the run

## REMOVED Requirements

### Requirement: Agents push and write files
**Reason**: Replaced by "Agents push and write the pull request files". The `@lead` role is removed, and the implementor writes and pushes the pull request.
**Migration**: A project's `@lead` binding goes unused; the step runs on the `@implementor` binding.
