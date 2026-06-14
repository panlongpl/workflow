## Why

The AI Terminal currently has controls split between the app-level terminal toolbar and an extra in-terminal header. This creates duplicated hierarchy, wastes vertical space above the terminal, and leaves no clear control for reconnecting a dropped or unavailable terminal session.

## What Changes

- Remove the in-terminal session header from the normal terminal view so the terminal surface starts directly under the app-level toolbar.
- Move the fullscreen action into the app-level terminal toolbar beside Clear, Stop, and New Session.
- Add a Reconnect action in the app-level terminal toolbar.
- Define reconnect behavior for unavailable, disconnected, or stale terminal sessions while preserving New Session as a full reset/start-over action.
- Preserve existing Clear, Stop, New Session, and fullscreen semantics unless explicitly refined by this change.

## Capabilities

### New Capabilities
- `terminal-session-controls`: Covers app-level AI Terminal session controls, including clear, stop, fullscreen, new session, and reconnect behavior.

### Modified Capabilities
- `agent-availability-indicator`: Agent availability text remains visible in the header identity area and should stay consistent with reconnectable/unavailable terminal session states.

## Impact

- Affected UI files: `index.html`, `src/app.js`, `src/terminal.js`, `styles/layout.css`, `styles/terminal.css`, and `styles/responsive.css`.
- No backend API or persistence changes are expected.
- Reconnect may reuse existing terminal controller/session launch details; if the previous command cannot be safely reused, the UI should fall back to the existing start/new-session flow.
