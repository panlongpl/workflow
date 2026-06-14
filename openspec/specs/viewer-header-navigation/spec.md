## Requirements

### Requirement: Viewer header separates identity from contextual tools
The system SHALL render the viewer header with a document or module identity area that is visually distinct from contextual controls for the active workflow.

#### Scenario: Markdown document is open
- **WHEN** a Markdown document is open in the Markdown module
- **THEN** the header identity area displays the current document name and path metadata
- **THEN** Markdown view and reading controls are displayed in a separate contextual toolbar area

#### Scenario: AI Terminal module is active
- **WHEN** the AI Terminal module is active
- **THEN** the header identity area displays the AI Terminal title and session metadata
- **THEN** terminal session actions are displayed in the contextual toolbar area

### Requirement: Module navigation is visually separate from document view controls
The system SHALL present Markdown and AI Terminal module navigation as global module navigation, not as part of the current-document view switch.

#### Scenario: User switches to AI Terminal
- **WHEN** the user activates the AI Terminal module navigation control
- **THEN** the system switches to the terminal module
- **THEN** Markdown document view controls are hidden from the active contextual toolbar

#### Scenario: User switches to Markdown Browser
- **WHEN** the user activates the Markdown Browser module navigation control
- **THEN** the system switches to the Markdown module
- **THEN** Markdown contextual controls are shown when applicable

### Requirement: Markdown toolbar groups document-specific controls
The system SHALL group Markdown-specific controls together in the contextual toolbar, including raw view, AI reading view, reading mode, annotation history, AI regeneration when available, and automatic comment dispatch preference.

#### Scenario: Markdown module is active
- **WHEN** the Markdown module is active
- **THEN** the contextual toolbar contains the current-document view controls
- **THEN** the contextual toolbar contains Markdown-specific reading and annotation controls

#### Scenario: History action is activated
- **WHEN** the user activates the annotation history action from the Markdown toolbar
- **THEN** the system opens the existing annotation history view
- **THEN** the history action is not presented as a peer of raw and AI reading document views

### Requirement: Terminal toolbar groups terminal-specific actions
The system SHALL show terminal session actions in the contextual toolbar only when the AI Terminal module is active.

#### Scenario: Terminal module is active
- **WHEN** the AI Terminal module is active
- **THEN** the contextual toolbar exposes terminal clear, stop, and new session actions

#### Scenario: Markdown module is active
- **WHEN** the Markdown module is active
- **THEN** terminal clear, stop, and new session actions are hidden from the contextual toolbar

### Requirement: Header avoids transient scroll actions
The system SHALL NOT reserve primary header space for transient scroll movement actions such as scrolling to the top of the document.

#### Scenario: User views the primary header
- **WHEN** the user views the primary header controls
- **THEN** the header does not include a top-of-page scroll button as a primary toolbar action

### Requirement: Header remains usable at narrow widths
The system SHALL keep header text and controls readable and non-overlapping at narrow viewport widths.

#### Scenario: Viewport is narrow
- **WHEN** the viewport width is constrained to a mobile-sized layout
- **THEN** header identity and toolbar controls wrap or stack without overlapping each other
- **THEN** controls remain keyboard accessible and visible labels remain understandable
