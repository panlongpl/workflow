## Requirements

### Requirement: Terminal controls are grouped in the app toolbar
The system SHALL present AI Terminal session actions in the app-level terminal toolbar, including Clear, Stop, Fullscreen, Reconnect, and New Session.

#### Scenario: Terminal module is active
- **WHEN** the AI Terminal module is active
- **THEN** the app-level terminal toolbar displays Clear, Stop, Fullscreen, Reconnect, and New Session controls at the same visual hierarchy
- **THEN** the terminal surface does not display a separate in-terminal header for running state or fullscreen

#### Scenario: Markdown module is active
- **WHEN** the Markdown module is active
- **THEN** terminal session controls are hidden from the Markdown contextual toolbar

### Requirement: Terminal surface starts below the toolbar without an internal header
The system SHALL render the terminal content directly beneath the app-level terminal toolbar during normal terminal viewing.

#### Scenario: Agent session is running
- **WHEN** an Agent terminal session is running in normal non-fullscreen mode
- **THEN** the terminal surface begins directly below the app-level toolbar
- **THEN** the system MUST NOT show an extra in-terminal row containing running status or fullscreen actions

### Requirement: Fullscreen is controlled from the app toolbar
The system SHALL allow users to enter and exit terminal fullscreen from the app-level terminal toolbar.

#### Scenario: User enters fullscreen
- **WHEN** the user activates the Fullscreen control in the app-level terminal toolbar
- **THEN** the terminal enters fullscreen mode
- **THEN** no app header or terminal toolbar is visible inside fullscreen mode

#### Scenario: User exits fullscreen with Escape
- **WHEN** the terminal is fullscreen and the user presses Escape
- **THEN** the system exits fullscreen mode
- **THEN** the app-level header and terminal toolbar are restored

### Requirement: Reconnect restarts the previous terminal target
The system SHALL provide a Reconnect action that attempts to restore the most recent terminal session target without requiring the user to reselect the Agent.

#### Scenario: Previous Codex or Claude session is unavailable
- **GIVEN** the user previously started a Codex or Claude terminal session
- **WHEN** that session is closed, disconnected, or unavailable and the user activates Reconnect
- **THEN** the system starts a new session for the same Agent type
- **THEN** the terminal remains in the AI Terminal module

#### Scenario: Previous custom Agent session is unavailable
- **GIVEN** the user previously started a custom Agent session with a custom command
- **WHEN** that session is closed, disconnected, or unavailable and the user activates Reconnect
- **THEN** the system starts a new custom Agent session using the same custom command
- **THEN** the terminal remains in the AI Terminal module

#### Scenario: No previous session target exists
- **GIVEN** no Agent has been selected in the current page session
- **WHEN** the user activates Reconnect
- **THEN** the system does not start an unknown session
- **THEN** the system presents the existing Agent selection flow or feedback explaining that there is no previous session to reconnect

#### Scenario: Session is already running
- **GIVEN** a terminal session is already running and connected
- **WHEN** the user activates Reconnect
- **THEN** the system MUST NOT silently restart or interrupt the running session
- **THEN** the system either disables Reconnect or provides feedback that the session is already connected

### Requirement: New Session remains a full reset action
The system SHALL keep New Session distinct from Reconnect.

#### Scenario: User activates New Session
- **WHEN** the user activates New Session
- **THEN** the current terminal session is stopped or cleared according to existing behavior
- **THEN** the system returns to the Agent selection flow
- **THEN** the action does not automatically reuse the previous Agent target

### Requirement: Terminal controls remain accessible
The system SHALL provide understandable labels and keyboard-operable controls for all app-level terminal actions.

#### Scenario: User navigates terminal toolbar by keyboard
- **WHEN** the user tabs through the app-level terminal toolbar
- **THEN** Clear, Stop, Fullscreen, Reconnect, and New Session can each receive focus
- **THEN** each control has a visible or accessible label describing its action
