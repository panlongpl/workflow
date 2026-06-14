## ADDED Requirements

### Requirement: Persist successful directory selection
The system SHALL remember the most recent directory that was successfully loaded through the manual directory selection flow.

#### Scenario: Manual directory load succeeds
- **WHEN** the user selects a local Markdown directory and the directory snapshot loads successfully
- **THEN** the system stores the loaded directory root path and display name as the last selected directory

#### Scenario: Manual directory selection is canceled
- **WHEN** the user opens the directory picker and cancels without loading a directory
- **THEN** the system MUST NOT replace the remembered directory with an empty or canceled selection

### Requirement: Restore remembered directory on startup
The system SHALL automatically attempt to restore the remembered directory when the page initializes and no directory is currently loaded.

#### Scenario: Remembered directory is readable
- **WHEN** the page initializes with a remembered directory path that the backend can read
- **THEN** the system loads a fresh directory snapshot for that path without opening the native directory picker
- **THEN** the sidebar, current directory label, Markdown counts, directory watcher, and initial document preview are populated as if the directory had just been selected

#### Scenario: No remembered directory exists
- **WHEN** the page initializes without a remembered directory
- **THEN** the system shows the normal unselected directory state and allows the user to choose a local directory

### Requirement: Handle stale remembered directories
The system SHALL recover gracefully when a remembered directory can no longer be read.

#### Scenario: Remembered directory cannot be read
- **WHEN** the page initializes with a remembered directory path that the backend rejects or cannot read
- **THEN** the system clears or ignores the stale remembered directory
- **THEN** the system shows a clear fallback state that allows the user to choose a local directory again

#### Scenario: Restore fails after showing loading state
- **WHEN** an automatic restore attempt fails after the UI has entered a restoring or loading state
- **THEN** the system resets the choose-directory button and loading indicator so the user is not stuck in a disabled or busy state
