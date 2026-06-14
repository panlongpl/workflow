## 1. History Markup Structure

- [x] 1.1 Refactor `renderHistoryHeader()` so the history header reads as a compact toolbar with title/count/context and action groups.
- [x] 1.2 Refactor `renderHistoryDocument()` so document groups render as lightweight section headings rather than heavy container cards.
- [x] 1.3 Refactor `renderHistoryAnnotation()` so each annotation is an independent card with selection, quote, note, metadata, and action regions.
- [x] 1.4 Preserve all existing event wiring for mode switching, selection, open, send, send selected, and copy all after markup changes.

## 2. Visual Styling

- [x] 2.1 Update `styles/history.css` page spacing/background so the history page supports a card-flow reading layout.
- [x] 2.2 Style the compact toolbar, including mode switch, selected count, total count, and batch actions.
- [x] 2.3 Style document section headings with file name, path/root context, and count while reducing container border weight.
- [x] 2.4 Style annotation cards with clear quote, note, metadata, selection, and footer action hierarchy.
- [x] 2.5 Keep flat single-line mode visually consistent with the redesigned page.

## 3. Responsive Behavior

- [x] 3.1 Update history-related responsive rules so toolbar controls wrap cleanly on narrow screens.
- [x] 3.2 Ensure annotation card actions and metadata stack without horizontal overflow on narrow screens.

## 4. Verification

- [x] 4.1 Verify grouped mode renders document sections and annotation cards for empty, single-document, and multi-document histories.
- [x] 4.2 Verify flat mode still displays the same single-line note content and copy-all still copies expected content.
- [x] 4.3 Verify selection, selected count, send selected, single-item send, and open actions still work.
- [x] 4.4 Run available syntax/build checks for edited frontend files.
