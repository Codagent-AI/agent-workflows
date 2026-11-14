## ADDED Requirements

### Requirement: The review strategy picks the reviewer
The pack SHALL run the review that the `review_strategy` setting names. Its values SHALL be `builtin`, the default, and `none`.

#### Scenario: Default strategy
- **WHEN** a launch does not set `review_strategy`
- **THEN** the builtin reviewer runs before the pull request opens and in each acceptance round that has a fix

#### Scenario: Review is off
- **WHEN** `review_strategy` is `none`
- **THEN** no review runs, before the pull request or in any acceptance round, and no review result is written

### Requirement: The builtin reviewer only inspects the changed code
The builtin reviewer SHALL run on the `@reviewer` role. Its review instructions SHALL be the code-quality, security and error-handling review prompts that `factory-workflows/archon/PROVENANCE.md` records, copied word for word and joined in that order. It SHALL review only the code the change changed, leave out the change folder, and change no file.

#### Scenario: Reviewer instructions
- **WHEN** the builtin reviewer runs
- **THEN** its prompt holds the three copied prompts in that order, then what to review and the findings shape

#### Scenario: Change folder is left out
- **WHEN** the changes under review include files in the change folder
- **THEN** the reviewer does not review those files

#### Scenario: Reviewer changes nothing
- **WHEN** a review ends
- **THEN** the worktree and the branch are as they were before the review

### Requirement: A review cycle keeps one reviewer session
A review cycle SHALL be a first review and its re-reviews: one cycle before the pull request, and one in each acceptance round that reviews a fix. The first review of a cycle SHALL start a fresh reviewer session, and the cycle's re-reviews SHALL continue it. The review of a commit made after the cycle and before the pull request opens SHALL start a fresh session.

#### Scenario: First review of a cycle
- **WHEN** the first review before the pull request, or the first review in an acceptance round, runs
- **THEN** it starts a fresh reviewer session

#### Scenario: Re-review in the same cycle
- **WHEN** a review runs after a fix round in the same cycle
- **THEN** it continues the session of the cycle's first review

#### Scenario: Next acceptance round
- **WHEN** a later acceptance round reviews its fix
- **THEN** that review starts a fresh session, not the earlier round's

#### Scenario: Commit after the review
- **WHEN** a commit made after the review and before the pull request opens is reviewed
- **THEN** that review starts a fresh session

### Requirement: Every strategy returns the same findings shape
A review SHALL return a list of findings in one shared shape. An empty list SHALL mean the review found no defect. The workflow SHALL give each finding an ID and a state, and SHALL record each fix, decline, contest and reply against that ID.

#### Scenario: Review finds nothing
- **WHEN** the reviewer finds no defect and no finding is open
- **THEN** it returns an empty list, and the result says exactly `No findings.`

#### Scenario: Review finds defects
- **WHEN** the reviewer finds defects
- **THEN** it returns each one with a title, a file, a line or none, a severity of `high`, `medium` or `low`, a category of `quality`, `security` or `error-handling`, the problem and a suggested fix, and the workflow records it as `open` with the next ID, `R1`, `R2` and so on

#### Scenario: States follow the debate
- **WHEN** the fixer or the reviewer acts on a finding
- **THEN** a fix makes it `fixed`, a decline `declined`, a contest `contested`, a reply `replied`, a confirmed fix or an accepted decline or reply `closed`, a rejected fix `open` again, and a contest after a reply `disputed`

#### Scenario: Action does not fit the state
- **WHEN** the fixer or the reviewer names an unknown ID, or acts in a way the finding's state does not allow
- **THEN** the workflow ignores that action, notes it in the result, and keeps the finding's state

### Requirement: The first review covers the whole change
The first review before the pull request SHALL cover every change from the revision where the implementor started to the head.

#### Scenario: Whole change is covered
- **WHEN** the first review before the pull request runs
- **THEN** it covers the changes from the revision where the implementor's first step started to the head

#### Scenario: Start cannot be read
- **WHEN** the workflow cannot read the revision where the implementor started
- **THEN** the run fails before the review, naming the reason

### Requirement: The implementor fixes the findings in its own session
The fixer SHALL be the implementor, continuing its own session.

#### Scenario: Fixer before the pull request
- **WHEN** the review before the pull request leaves findings that are not closed
- **THEN** the implementor handles them in a continuation of the session that wrote the session report

#### Scenario: Fixer in an acceptance round
- **WHEN** the review in an acceptance round leaves findings that are not closed
- **THEN** the implementor handles them in a continuation of the session that made the round's fix

### Requirement: Each fix round is a fixer turn and a re-review
After the first review of a cycle, each fix round SHALL be one fixer turn followed by one re-review. In its turn, the fixer SHALL handle each finding that is not closed: fix it and commit, decline to fix it and say why, or reply to a contested decline.

#### Scenario: Fixer fixes a finding
- **WHEN** the fixer fixes a finding
- **THEN** it commits the fix and marks the finding fixed, and the re-review follows

#### Scenario: Fixer declines to fix a finding
- **WHEN** the fixer decides a finding is not a defect
- **THEN** it declines to fix it and records its reason, and the re-review follows

### Requirement: A re-review checks the fixes, the declines and the new changes
A re-review SHALL confirm or reject each fix, accept each decline or contest it with a reason, and look for new defects of any priority only in what changed since the last reviewed revision. A finding SHALL close when the reviewer confirms its fix or accepts its decline.

#### Scenario: Fix is confirmed
- **WHEN** the re-review finds that a fix resolved its finding
- **THEN** the finding closes

#### Scenario: Fix is rejected
- **WHEN** the re-review finds that a finding marked fixed still exists
- **THEN** the finding stays open

#### Scenario: Decline is accepted
- **WHEN** the reviewer agrees with a decline
- **THEN** the finding closes, with the fixer's reason

#### Scenario: Decline is contested
- **WHEN** the reviewer disagrees with a decline
- **THEN** it gives its reason, and the contest reaches the fixer in the next fix round, if one is left

#### Scenario: New defect in the changes
- **WHEN** the changes since the last reviewed revision add a defect
- **THEN** the re-review reports it as a new finding, whatever its priority

#### Scenario: Earlier code is not reviewed again
- **WHEN** a re-review runs
- **THEN** it does not look for new defects in code an earlier review in the run already covered

#### Scenario: Nothing to review
- **WHEN** nothing changed since the last reviewed revision and no finding is open
- **THEN** the review passes without running the reviewer

### Requirement: A decline can be contested once
The reviewer SHALL contest a decline at most once. When it still disagrees after the fixer's reply, the finding SHALL be disputed and leave the fix rounds.

#### Scenario: Reply persuades the reviewer
- **WHEN** the fixer replies to a contest and the reviewer accepts the reply
- **THEN** the finding closes, with the fixer's reason

#### Scenario: Reviewer still disagrees
- **WHEN** the reviewer still disagrees after the fixer's reply
- **THEN** the finding is disputed, and no later round handles it

### Requirement: Fix rounds are bounded
The cycle before the pull request SHALL run at most three fix rounds, and the cycle in an acceptance round SHALL run one. The rounds SHALL stop sooner when every finding is closed or disputed, or when the fixer reports itself blocked. Stopping SHALL NOT fail the run.

#### Scenario: Rounds run out
- **WHEN** findings are still open before the pull request after the re-review that follows the third fixer turn
- **THEN** no fourth fixer turn runs

#### Scenario: Acceptance round has one fix round
- **WHEN** findings are not closed after an acceptance round's re-review
- **THEN** no second fixer turn runs in that round, and a contested decline is handed off with both sides

#### Scenario: Everything is settled
- **WHEN** every finding is closed or disputed after a re-review
- **THEN** the rounds stop

#### Scenario: Fixer is blocked
- **WHEN** the fixer reports itself blocked
- **THEN** the rounds stop, the findings keep their states, and the run continues

### Requirement: Findings that were not fixed go to the assumptions record
When a cycle's fix rounds stop, the workflow SHALL add to `acceptance-assumptions.md` each `high` or `medium` finding that is not closed, with both sides of a contested or disputed finding, and each `high` or `medium` finding that closed because the reviewer accepted a decline or a reply, with the fixer's reason. A `low` finding that is not closed SHALL stay in the review result only. The run SHALL continue. Findings SHALL NOT fail the run.

#### Scenario: Findings remain before the pull request
- **WHEN** `high` or `medium` findings are not closed when the rounds before the pull request stop
- **THEN** each one is added to `acceptance-assumptions.md` with the result file, any statement that nothing is unresolved is removed, and the draft pull request opens

#### Scenario: Disputed finding
- **WHEN** a finding is disputed
- **THEN** its entry holds the reviewer's finding and contest and the fixer's decline and reply

#### Scenario: Accepted decline
- **WHEN** the reviewer accepts a decline or a reply on a `high` or `medium` finding
- **THEN** the finding closes, and its entry holds the finding and the fixer's reason

#### Scenario: Low finding
- **WHEN** a `low` finding is not closed when the rounds stop
- **THEN** it is listed in the review result and not added to `acceptance-assumptions.md`

#### Scenario: Findings remain in an acceptance round
- **WHEN** `high` or `medium` findings are not closed when a round's fix round ends
- **THEN** each one is added to `acceptance-assumptions.md`, and the round goes on to the push

#### Scenario: Nothing remains
- **WHEN** every `high` and `medium` finding of a cycle closed with a confirmed fix
- **THEN** nothing is added to `acceptance-assumptions.md`

### Requirement: A later cycle does not reopen recorded findings
A review SHALL NOT check a finding that an earlier cycle added to the assumptions record.

#### Scenario: Recorded finding is handed off
- **WHEN** a finding was added to `acceptance-assumptions.md` in an earlier cycle
- **THEN** no later review in the run checks it

### Requirement: The pull request's head is reviewed
The draft pull request SHALL open only after a review covered its exact head. When a step after the review commits before the pull request opens, the workflow SHALL review the new changes first.

#### Scenario: Repair commits after the review
- **WHEN** a repair commits after the review and before the pull request opens
- **THEN** those changes are reviewed before the pull request opens, with no fix rounds, and each new `high` or `medium` finding goes to `acceptance-assumptions.md`

#### Scenario: Head was reviewed
- **WHEN** the draft pull request opens
- **THEN** the latest review result before the pull request ends at the pull request's head

### Requirement: Each review place keeps one result
The workflow SHALL keep one review result for before the pull request and one for the acceptance rounds, under the run's artifacts folder. Each review SHALL overwrite the result for its place. A result SHALL name the revisions it covered, list the open and disputed findings, and list the accepted declines with their reasons.

#### Scenario: Result after a review
- **WHEN** a review ends
- **THEN** its place's result names the start and end revisions it covered, lists the open and disputed findings or says `No findings.`, and lists each accepted decline with its reason

#### Scenario: Later round
- **WHEN** a review runs in a later acceptance round
- **THEN** it replaces the acceptance result from the earlier round

### Requirement: A review that cannot produce a result fails the run
When a review ends without a result in the findings shape, the workflow SHALL fail the run, naming the review.

#### Scenario: Result is not in the shape
- **WHEN** the reviewer's output is not a findings list in the shared shape
- **THEN** the run fails, naming the review and where its output is
