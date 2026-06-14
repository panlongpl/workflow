## Context

The Markdown viewer currently selects a directory through the backend `/api/choose-directory` flow, which opens a native macOS folder picker and returns a directory snapshot. The app already has `/api/read-directory`, which can read a directory snapshot from a supplied `rootPath`, and `loadDirectorySnapshot()` centralizes state updates, navigation rendering, watcher startup, and initial file opening.

The main gap is startup state: `state.rootPath` is initialized empty on every page load, so refreshes lose the selected directory even when the backend can still read it. Browser storage is already used for other UI preferences, so a small last-directory record fits the existing local-only model.

## Goals / Non-Goals

**Goals:**
- Restore the last successfully selected Markdown directory automatically after page refresh.
- Reuse existing directory snapshot loading behavior so restored directories behave like freshly selected directories.
- Avoid opening the native directory picker during automatic restore.
- Provide clear fallback behavior when the saved directory path is stale or unreadable.

**Non-Goals:**
- Persist or restore browser File System Access handles.
- Restore the previously opened Markdown file, scroll position, expanded directory state, or query text.
- Add multi-directory history or a directory picker replacement.
- Change annotation storage, AI reading, terminal behavior, or directory watcher semantics beyond startup restoration.

## Decisions

1. Store a lightweight record in `localStorage`.

   The frontend will store `{ rootPath, rootName }` under a versioned key after `loadDirectorySnapshot()` succeeds. This keeps storage local to the browser, matches existing preference persistence, and avoids introducing backend state.

   Alternative considered: write the last directory to a backend config file. That would survive browser storage clearing but creates a new cross-process state surface and is unnecessary for this refresh-focused UX.

2. Restore by calling `/api/read-directory` with the saved `rootPath`.

   The backend already validates the path by resolving it and reading a fresh snapshot, then starts the directory watcher. Reusing this endpoint keeps restore behavior aligned with manual selection and avoids a new API.

   Alternative considered: cache the full previous snapshot in `localStorage`. That would make the page appear faster but risks showing stale files and duplicates the backend scanner.

3. Treat restore failure as non-blocking.

   If `/api/read-directory` fails, the app will clear or ignore the saved record, reset the sidebar to the normal unselected state, and show a clear status/message. The user can then click "选择本地目录" and continue with the existing flow.

   Alternative considered: keep retrying the stale path in the background. That could leave users in a confusing loading or error loop after moving/deleting a directory.

4. Keep manual selection authoritative.

   A successful manual directory selection overwrites the saved record. Canceling the native picker does not overwrite or clear the saved record, because no new directory was successfully loaded.

   Alternative considered: clear the saved record when the user cancels. Canceling is not the same as rejecting the previous directory and could make accidental cancels more disruptive.

## Risks / Trade-offs

- Saved absolute paths may become stale after renames, deletions, or permission changes -> Restore failure clears or ignores stale state and returns to normal manual selection.
- `localStorage` can be cleared by the browser -> The app falls back to the current unselected startup behavior.
- Restore may scan a large directory on page load -> Show an explicit restoring/loading state and reuse the existing scanner; no cached stale directory listing is shown.
- Automatic restore could surprise users who expected a blank state -> The current path/status will make the restored directory visible, and the manual choose button remains available to switch directories.
