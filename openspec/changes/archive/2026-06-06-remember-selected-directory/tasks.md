## 1. Directory Memory Storage

- [x] 1.1 Add a versioned localStorage key and helper functions to read, write, and clear the last selected directory record.
- [x] 1.2 Persist `{ rootPath, rootName }` only after `loadDirectorySnapshot()` completes successfully.
- [x] 1.3 Ensure canceling the native directory picker does not overwrite or clear the remembered directory record.

## 2. Startup Restore Flow

- [x] 2.1 Add startup initialization that reads the remembered directory before rendering the default unselected empty state.
- [x] 2.2 Call `readDirectorySnapshot(saved.rootPath)` to restore a fresh snapshot without invoking `chooseDirectorySnapshot()`.
- [x] 2.3 Reuse `loadDirectorySnapshot()` for restored snapshots so navigation, counts, watcher startup, and initial file preview match manual selection.

## 3. Restore Failure Handling

- [x] 3.1 Show an informative restoring/loading status while automatic restore is in progress.
- [x] 3.2 If restore fails, clear or ignore the stale remembered directory and reset the choose button/loading state.
- [x] 3.3 Render the normal choose-directory empty state after restore failure so the user can manually select a new directory.

## 4. Verification

- [ ] 4.1 Verify selecting a directory, refreshing the page, and seeing the same directory restored without opening the native picker.
- [ ] 4.2 Verify a canceled manual directory selection leaves the previous remembered directory unchanged.
- [ ] 4.3 Verify an unreadable or removed remembered directory falls back to the manual selection state without leaving the UI stuck.
- [x] 4.4 Run the relevant frontend syntax checks or smoke tests for touched modules.
