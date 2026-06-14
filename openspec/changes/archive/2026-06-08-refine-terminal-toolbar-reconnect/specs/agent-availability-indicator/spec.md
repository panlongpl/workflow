## ADDED Requirements

### Requirement: Agent availability remains consistent with reconnect states
The system SHALL keep the header Agent availability indicator consistent with terminal reconnect states.

#### Scenario: Session becomes unavailable after prior launch
- **WHEN** a previously launched Agent session closes, disconnects, or becomes unavailable
- **THEN** the header Agent availability indicator updates to unavailable or connection-unavailable state
- **THEN** the indicator MUST NOT continue to present the Agent as currently available

#### Scenario: Reconnect starts successfully
- **WHEN** the user reconnects and the replacement Agent session reaches running state
- **THEN** the header Agent availability indicator updates to available
- **THEN** the indicator displays the reconnected Agent label or custom command summary

#### Scenario: Reconnect cannot proceed
- **WHEN** reconnect cannot proceed because no previous target exists or required launch details are missing
- **THEN** the header Agent availability indicator remains consistent with the actual non-running state
- **THEN** the system MUST NOT show a green available state merely because Reconnect was requested
