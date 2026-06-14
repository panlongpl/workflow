## Why

Refreshing the Markdown viewer currently drops the selected directory and forces the user to choose it again, interrupting the common workflow of iterating on local Markdown files. Remembering the last selected directory makes refreshes and browser restarts feel continuous while preserving the existing explicit directory selection flow.

## What Changes

- Persist the last successfully loaded local directory path and display name in browser storage after the user chooses a directory.
- On page load, automatically attempt to restore the saved directory by re-reading it through the existing backend directory snapshot API.
- Keep the UI informative during restore: show that the app is restoring the previous directory, then either load the directory or show a clear fallback state.
- If the saved directory can no longer be read, clear or ignore the stale saved directory and allow the user to choose a directory normally.
- Do not re-open the native directory picker during automatic restore.

## Capabilities

### New Capabilities
- `remember-selected-directory`: Restores the last successfully selected Markdown directory after page refresh without requiring the user to reselect it.

### Modified Capabilities
- None.

## Impact

- Frontend state initialization in `src/app.js`.
- Frontend API usage through `src/api.js` and the existing `/api/read-directory` endpoint.
- Browser storage for a small last-directory record.
- Markdown navigation, current path/status display, directory watcher startup, and initial file loading after restore.
