## Requirements

### Requirement: History page presents a compact toolbar
The system SHALL present the history annotations page with a compact toolbar that includes page identity, total annotation count, display mode controls, and batch actions without using a visually heavy nested header card.

#### Scenario: User opens history annotations
- **WHEN** the user opens the history annotations view
- **THEN** the system displays a compact toolbar containing the history title, total annotation count, grouped/flat mode controls, copy-all action, and grouped-mode batch dispatch controls when applicable

#### Scenario: History storage path remains available
- **WHEN** the history annotations view is displayed
- **THEN** the system makes the annotation storage path visible or otherwise available as secondary context without dominating the page content

### Requirement: Grouped history uses lightweight document sections
The system SHALL present grouped history annotations as document sections where the document heading provides file name, path/root context, and annotation count, and SHALL avoid making the document container visually heavier than its annotation cards.

#### Scenario: Grouped view contains multiple documents
- **WHEN** grouped history annotations contain annotations from multiple documents
- **THEN** the system renders each document as a lightweight section heading followed by that document's annotation cards

#### Scenario: Document section shows count
- **WHEN** a document section is rendered
- **THEN** the system displays the number of annotations associated with that document

### Requirement: Annotation items render as readable cards
The system SHALL render each grouped annotation as a readable card with distinct regions for selection, quoted source text, user note, metadata, and per-item actions.

#### Scenario: Annotation card displays content hierarchy
- **WHEN** an annotation card is rendered
- **THEN** the system visually separates quoted source text from the user note and gives metadata lower visual emphasis than the note content

#### Scenario: Annotation card preserves item actions
- **WHEN** an annotation card is rendered
- **THEN** the system provides controls to open the source location and send that annotation to the Agent

#### Scenario: Annotation card preserves selection
- **WHEN** grouped mode is active
- **THEN** the system provides a selectable control for each annotation so batch dispatch can use the selected set

### Requirement: Flat notes mode remains available
The system SHALL preserve the existing flat single-line notes mode for copying and dense review while aligning its container styling with the redesigned history page.

#### Scenario: User switches to flat mode
- **WHEN** the user selects flat mode
- **THEN** the system displays the single-line notes textarea with the same note content semantics as before

### Requirement: History layout remains responsive
The system SHALL keep the redesigned history layout usable on narrow screens by stacking toolbar actions, card footers, and item controls without horizontal overflow.

#### Scenario: User views history on a narrow viewport
- **WHEN** the viewport is narrow
- **THEN** the system stacks or wraps history toolbar controls and annotation card actions so all controls remain reachable without horizontal scrolling
