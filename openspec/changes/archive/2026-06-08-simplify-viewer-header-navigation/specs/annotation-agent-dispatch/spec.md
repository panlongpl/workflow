## ADDED Requirements

### Requirement: Automatic dispatch preference is compact in the redesigned header
The system SHALL keep the automatic comment dispatch preference available in the Markdown contextual toolbar using compact visible wording while preserving its existing persisted behavior.

#### Scenario: User views Markdown controls
- **WHEN** the Markdown module is active
- **THEN** the automatic comment dispatch preference is visible in the contextual toolbar
- **THEN** the visible label is compact enough to fit with other Markdown controls

#### Scenario: User changes automatic dispatch preference
- **WHEN** the user toggles the automatic comment dispatch preference from the redesigned toolbar
- **THEN** the system persists and applies the same automatic dispatch behavior as before the header redesign

### Requirement: Automatic dispatch preference is hidden outside Markdown context
The system SHALL hide the automatic comment dispatch preference from the contextual toolbar when the AI Terminal module is active.

#### Scenario: Terminal module is active
- **WHEN** the AI Terminal module is active
- **THEN** the automatic comment dispatch preference is not shown as a terminal toolbar control
