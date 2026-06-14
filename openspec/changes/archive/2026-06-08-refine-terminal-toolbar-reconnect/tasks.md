## 1. Toolbar Structure

- [x] 1.1 Add app-level terminal toolbar controls for Fullscreen and Reconnect beside Clear, Stop, and New Session.
- [x] 1.2 Remove any remaining normal-mode in-terminal session header and keep terminal content directly below the app toolbar.
- [x] 1.3 Keep terminal controls hidden outside the AI Terminal module.

## 2. Terminal Controller Behavior

- [x] 2.1 Expose controller methods for fullscreen and reconnect actions from the app-level toolbar.
- [x] 2.2 Store enough previous launch metadata to reconnect Codex, Claude, and custom Agent sessions.
- [x] 2.3 Implement reconnect behavior for unavailable or disconnected sessions without silently interrupting a running session.
- [x] 2.4 Preserve New Session as a full reset to the Agent selection flow.
- [x] 2.5 Keep Agent availability notifications accurate across disconnect, reconnect start, reconnect success, and reconnect failure.

## 3. Styling And Accessibility

- [x] 3.1 Style the terminal toolbar so Clear, Stop, Fullscreen, Reconnect, and New Session share one visual hierarchy.
- [x] 3.2 Ensure fullscreen mode hides app and toolbar chrome while preserving Escape-based exit.
- [x] 3.3 Provide visible or accessible labels and keyboard focus behavior for all terminal toolbar actions.
- [x] 3.4 Verify responsive toolbar wrapping does not overlap the terminal surface.

## 4. Verification

- [x] 4.1 Run JavaScript syntax checks for changed modules.
- [x] 4.2 Verify the local app loads without browser console errors.
- [x] 4.3 Verify toolbar visibility and reconnect/fullscreen states in the AI Terminal UI.
