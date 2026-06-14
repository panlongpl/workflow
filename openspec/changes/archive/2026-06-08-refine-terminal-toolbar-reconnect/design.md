## Context

The AI Terminal now has an app-level terminal toolbar in the viewer header and a terminal surface rendered by `src/terminal.js`. The user wants all terminal controls to live in the app-level toolbar, without an additional in-terminal header above the xterm surface. They also need a Reconnect action for cases where a terminal-backed Agent session becomes unavailable, disconnected, or stale.

The existing terminal controller already owns session lifecycle state, socket creation, Agent launch metadata, fullscreen state, and availability notifications. The least disruptive implementation is to keep that ownership in the controller and expose one more toolbar action from `src/app.js`.

## Goals / Non-Goals

**Goals:**

- Present Clear, Stop, Fullscreen, Reconnect, and New Session at the same toolbar level.
- Remove the normal-mode in-terminal session header so the terminal starts directly below the app toolbar.
- Keep fullscreen behavior available from the app toolbar and preserve Escape-based exit behavior.
- Add reconnect behavior that reuses the last known Agent launch configuration when safe.
- Keep Agent availability/status text consistent with reconnect, disconnected, and unavailable states.

**Non-Goals:**

- Change Agent CLI commands, backend WebSocket protocol shape beyond existing session start/stop/input messages, or terminal rendering library.
- Persist terminal sessions across page reloads.
- Implement multi-session terminal tabs or session history.

## Decisions

### Keep session lifecycle inside the terminal controller

The terminal controller should continue to own `selectedAgent`, `customCommand`, socket state, session state, and terminal rendering. The app-level toolbar should call controller methods rather than duplicating lifecycle logic.

Alternative considered: move session state into `src/app.js`. That would make toolbar wiring direct, but it would split terminal lifecycle responsibility across two files and increase the chance of state mismatch.

### Reconnect reuses the previous launch target

Reconnect should restart the most recent session using the previous Agent key, custom command if applicable, and current `getCwd()` value. It should be enabled when a session was previously selected and is closed, disconnected, or otherwise unavailable. If no prior launch target exists, reconnect should fall back to the start-selection flow and provide clear feedback.

Alternative considered: make reconnect equivalent to New Session. That would not solve the user problem because it loses the previous Agent choice and forces the user through setup again.

### Fullscreen belongs in the terminal toolbar

Fullscreen should be exposed beside Clear, Stop, Reconnect, and New Session. The in-terminal header should not be needed for fullscreen or status. Status remains available in the viewer identity row through existing Agent availability and document/session metadata.

Alternative considered: keep an in-terminal mini header only for fullscreen. This preserves a local control, but it is exactly the redundant top strip the user wants removed.

### Reconnect is conservative around running sessions

When a supported session is already running and connected, reconnect should not silently restart it. The implementation may disable the action, no-op with feedback, or perform an explicit reconnect only after first stopping the current session. The preferred behavior is disabled/no-op for running sessions to avoid interrupting active work.

## Risks / Trade-offs

- Reconnect can accidentally kill useful terminal state if it behaves like restart -> Keep reconnect disabled or no-op while the session is running.
- Prior launch metadata may be incomplete for custom commands -> Store the last custom command in the controller and fall back to the selection view if missing.
- Removing the in-terminal header reduces local status visibility -> Preserve status through the app header Agent indicator and terminal toolbar button states.
- Fullscreen API behavior differs across browsers -> Keep CSS fullscreen fallback and listen for `fullscreenchange` to synchronize state.
