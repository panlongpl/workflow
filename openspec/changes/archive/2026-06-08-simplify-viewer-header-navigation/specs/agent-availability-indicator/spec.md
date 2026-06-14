## ADDED Requirements

### Requirement: Agent availability is integrated into the header identity row
The system SHALL show Agent availability in the redesigned header identity row as a compact status indicator that remains separate from contextual Markdown and terminal toolbar actions.

#### Scenario: Header is rendered
- **WHEN** the viewer header is visible
- **THEN** Agent availability is displayed in the identity row
- **THEN** Agent availability is not grouped as a Markdown document view control

#### Scenario: Agent availability text is long
- **WHEN** the active Agent label or command summary is long
- **THEN** the visible Agent availability control truncates or constrains text without overlapping adjacent controls
- **THEN** the full status remains available through accessible text or title metadata
