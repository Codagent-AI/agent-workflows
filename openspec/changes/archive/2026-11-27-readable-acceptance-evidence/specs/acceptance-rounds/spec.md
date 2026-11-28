## ADDED Requirements

### Requirement: The handoff corrects evidence the page would leave out
After the tester's pass in each acceptance round and each retest, the workflow SHALL read that round's screenshot, command and journey records as the review page does, and give the handoff each problem it finds with its file, or none. Before writing the handoff, the tester SHALL correct each listed record. It MUST correct a command's excerpt to match its saved output, and MUST NOT change a saved output to match its excerpt.

#### Scenario: Reworded excerpt
- **WHEN** a round's command entry quotes wording its saved output doesn't contain
- **THEN** the round's handoff receives that output's file and the problem
- **AND** the tester replaces the excerpt with a run of whole lines from the saved output

#### Scenario: Another round's problem
- **WHEN** round 0 has a bad record and round 1 has none
- **THEN** round 1's handoff receives no problems

#### Scenario: Retest
- **WHEN** a feedback round retests journeys and the retest records a command entry with a bad excerpt
- **THEN** the retest's handoff receives that output's file and the problem
