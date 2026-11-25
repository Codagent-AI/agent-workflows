## MODIFIED Requirements

### Requirement: A review cycle keeps one reviewer session
A review cycle SHALL be a first review and its re-reviews: one cycle before the pull request, one in each acceptance round that reviews a fix, and one in each feedback round. The first review of a cycle SHALL start a fresh reviewer session, and the cycle's re-reviews SHALL continue it. The review of a commit made after the cycle and before the pull request opens SHALL start a fresh session.

#### Scenario: First review of a cycle
- **WHEN** the first review before the pull request, the first review in an acceptance round, or the first review in a feedback round runs
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

#### Scenario: Feedback round review
- **WHEN** a feedback round's first review runs
- **THEN** it covers what changed since the last reviewed revision, including the conflict resolutions from merging in the base branch

### Requirement: Every strategy returns the same findings shape
A review SHALL return a list of findings in one shared shape. An empty list SHALL mean the review found no defect. The workflow SHALL give each finding an ID and a state, and SHALL record each fix, decline, contest and reply against that ID.

#### Scenario: Review finds nothing
- **WHEN** the reviewer finds no defect and no finding is open
- **THEN** it returns an empty list, and the result says exactly `No open findings.`

#### Scenario: Review finds defects
- **WHEN** the reviewer finds defects
- **THEN** it returns each one with a title, a file, a line or none, a severity of `high`, `medium` or `low`, a category of `quality`, `security` or `error-handling`, the problem and a suggested fix, and the workflow records it as `open` with the next ID, `REVIEW-1`, `REVIEW-2` and so on

#### Scenario: States follow the debate
- **WHEN** the fixer or the reviewer acts on a finding
- **THEN** a fix makes it `fixed`, a decline `declined`, a contest `contested`, a reply `replied`, a confirmed fix or an accepted decline or reply `closed`, a rejected fix `open` again, and a contest after a reply `disputed`

#### Scenario: Action does not fit the state
- **WHEN** the fixer or the reviewer names an unknown ID, or acts in a way the finding's state does not allow
- **THEN** the workflow ignores that action, notes it in the result, and keeps the finding's state

### Requirement: Fix rounds are bounded
The cycle before the pull request SHALL run at most three fixer turns, each followed by a re-review. The cycle in an acceptance round or a feedback round SHALL run one fixer turn and one re-review. The rounds SHALL stop sooner when every finding is closed or disputed, or when the fixer reports itself blocked. Stopping SHALL NOT fail the run.

#### Scenario: Rounds run out
- **WHEN** findings are still open before the pull request after the re-review that follows the third fixer turn
- **THEN** no fourth fixer turn runs

#### Scenario: Acceptance round has one fix round
- **WHEN** findings are not closed after an acceptance round's re-review
- **THEN** no second fixer turn runs in that round, and a contested decline is handed off with both sides

#### Scenario: Feedback round review
- **WHEN** findings are not closed after a feedback round's re-review
- **THEN** no second fixer turn runs in that round, and each `high` or `medium` finding goes to the dispute log, a contested decline with both sides

#### Scenario: Everything is settled
- **WHEN** every finding is closed or disputed after a re-review
- **THEN** the rounds stop

#### Scenario: Fixer is blocked
- **WHEN** the fixer reports itself blocked
- **THEN** the rounds stop, the findings keep their states, and the run continues

### Requirement: A later cycle does not reopen recorded findings
A review SHALL NOT check a finding that an earlier cycle added to the decision log or the dispute log, unless the reviewer's answer on the review page asks for it to be fixed. Then the feedback round's review SHALL check that fix.

#### Scenario: Recorded finding is handed off
- **WHEN** a finding was added to either log in an earlier cycle and no answer asks for it to be fixed
- **THEN** no later review in the run checks it

#### Scenario: Reviewer asks for a logged finding to be fixed
- **WHEN** the reviewer's answer asks for a disputed finding to be fixed
- **THEN** the feedback round's review checks the fix, confirming or rejecting it

### Requirement: Each review place keeps one result
The workflow SHALL keep one review result for before the pull request, one for the acceptance rounds and one for the feedback rounds, under the run's artifacts folder. Each review SHALL overwrite the result for its place. A result SHALL name the revisions it covered, list the open and disputed findings, and list the accepted declines with their reasons.

#### Scenario: Result after a review
- **WHEN** a review ends
- **THEN** its place's result names the start and end revisions it covered, lists the open and disputed findings or says `No open findings.`, and lists each accepted decline with its reason

#### Scenario: Later round
- **WHEN** a review runs in a later acceptance round
- **THEN** it replaces the acceptance result from the earlier round

#### Scenario: Later feedback round
- **WHEN** a review runs in a later feedback round
- **THEN** it replaces the feedback result from the earlier round
