## MODIFIED Requirements

### Requirement: Each row has a valid status and the evidence it needs
The workflow SHALL check that each checklist row has a valid status and the evidence its status requires.

#### Scenario: Verified row cites evidence
- **WHEN** a row is `verified` and cites, in backticks, a non-empty file inside the evidence folder
- **THEN** the row passes

#### Scenario: Verified row cites nothing usable
- **WHEN** a `verified` row cites no file, only an empty file, or a path outside the evidence folder
- **THEN** the check reports the row's ID

#### Scenario: Failed or not-verified row gives no reason
- **WHEN** a row is `failed` or `not verified` and its Evidence cell is empty
- **THEN** the check reports that the row does not say why

#### Scenario: Row cites a manual test
- **WHEN** the checklist cites an acceptance test (`JOURNEY-n`, or `AT-n` from an older test plan) or a human-only test (`HUMAN-n`, or `HT-n`)
- **THEN** the check fails and lists the cited IDs

### Requirement: Only a named row may change its planned cells
The workflow SHALL allow a planned row's planned cells to change only where a finding names that row's ID.

#### Scenario: Finding names the row
- **WHEN** a finding names row `CHECK-2` and the implementor changes `CHECK-2`'s planned cells
- **THEN** the evidence check does not report `CHECK-2`

#### Scenario: No finding names the row
- **WHEN** a planned row changed and no finding names its ID
- **THEN** the check reports the row as changed

#### Scenario: Rows may be added after an audit
- **WHEN** a finding asks for a new row and the implementor adds it
- **THEN** the check does not report the added row

## ADDED Requirements

### Requirement: Checklist rows use CHECK codes
The implementor SHALL number checklist rows `CHECK-1`, `CHECK-2` and so on, with no zero padding. The workflow SHALL still read a checklist whose rows use the old `I-n` codes.

#### Scenario: New checklist
- **WHEN** the implementor writes a checklist
- **THEN** its rows are numbered `CHECK-1`, `CHECK-2` and so on

#### Scenario: Old checklist
- **WHEN** a checklist's rows use `I-n` codes
- **THEN** the checks read them as they do `CHECK-n` rows
