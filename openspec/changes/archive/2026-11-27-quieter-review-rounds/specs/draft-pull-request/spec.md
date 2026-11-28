## MODIFIED Requirements

### Requirement: Forge access is checked before any agent spends
The first node after input validation SHALL check that a forge plugin serves the host of the branch's remote with every operation the pack uses, including `pr.merge` and `workitem.create` when the wait is on, and that its credential resolves, without calling the forge.

#### Scenario: Plugin and credential are ready
- **WHEN** `archon forge check` reports a plugin and a credential for the remote's host
- **THEN** the node passes and prints the plugin, its version, the host and the credential source

#### Scenario: Remote has no usable host
- **WHEN** the branch's remote has no URL, or no host can be read from it
- **THEN** the run fails before any agent node runs

#### Scenario: CLI argv is missing
- **WHEN** `ARCHON_CLI_COMMAND` is not a JSON array of strings
- **THEN** the node fails naming the variable

#### Scenario: Forge cannot merge
- **WHEN** the wait is on and the forge plugin does not offer `pr.merge`
- **THEN** the run fails before any agent node runs, naming the missing operation

#### Scenario: Forge cannot file issues
- **WHEN** the wait is on and the forge plugin does not offer `workitem.create`
- **THEN** the run fails before any agent node runs, naming the missing operation

#### Scenario: Wait is off
- **WHEN** the wait is off and the forge plugin does not offer `pr.merge` or `workitem.create`
- **THEN** the check does not ask for them
