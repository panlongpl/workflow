## Why

The viewer header currently mixes document identity, module navigation, Markdown view controls, Agent status, comment automation, and transient actions in one dense row. This makes the top of the app visually noisy and harder to scan as more reading and Agent features are added.

## What Changes

- Split the viewer header into a document identity row and a contextual toolbar row.
- Move the global Markdown/AI Terminal module switch out of the crowded center header area.
- Keep Markdown-specific controls together: current document view, reading mode, annotation history, AI regeneration, and comment dispatch preference.
- Keep terminal-specific actions together when the AI Terminal module is active.
- Compact Agent availability and automatic comment dispatch status so they remain visible without dominating the header.
- Remove top-of-page scrolling from the primary header controls and keep scroll movement as contextual/floating actions.

## Capabilities

### New Capabilities
- `viewer-header-navigation`: Covers the information architecture, responsive behavior, and contextual controls for the viewer header and module navigation.

### Modified Capabilities
- `annotation-agent-dispatch`: Comment auto-dispatch remains available but is represented as a compact contextual control in the redesigned header.
- `agent-availability-indicator`: Agent availability remains visible but is integrated into the redesigned header hierarchy.

## Impact

- Affected UI files: `index.html`, `styles/layout.css`, `styles/responsive.css`, and `src/app.js`.
- No backend API, persistence, or dependency changes are expected.
- The change should preserve existing Markdown browsing, AI reading, annotation history, Agent dispatch, and terminal workflows while reducing visual clutter.
