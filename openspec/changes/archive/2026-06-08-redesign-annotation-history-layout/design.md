## Context

The history annotations page is currently rendered by `src/history.js` and styled mainly by `styles/history.css`. It supports two presentation modes: grouped by document and flat single-line notes. The grouped mode exposes selection, single-item open/send, send selected, and copy-all workflows.

The current layout nests a large header card, document cards, and row-like annotation items. That structure is functional, but visually dense: repeated borders and row actions compete with the quote and note text that users primarily need to read.

## Goals / Non-Goals

**Goals:**
- Make the grouped history page feel like a reading inbox/card flow rather than a table.
- Preserve existing history actions and state behavior.
- Improve visual hierarchy among page controls, document grouping, quote text, user note, metadata, selection, and actions.
- Keep the flat single-line mode available and visually consistent with the redesigned page.
- Keep the implementation local to the history view rendering and CSS where possible.

**Non-Goals:**
- Changing annotation storage format or history APIs.
- Changing how annotations are sent to Agent sessions.
- Adding search, filtering, editing, deletion, or new annotation management features.
- Redesigning the Markdown reader, sidebar navigation, terminal, or annotation drawer.

## Decisions

### Decision 1: Use a compact history toolbar instead of a heavy header card

The history header should become a lightweight toolbar containing title, total count, storage path, mode switch, and batch actions. This keeps controls discoverable while reducing the visual weight of the top of the page.

Alternative considered: keep the existing card and only adjust spacing. This would be less risky, but it does not address the repeated card nesting that makes the page feel heavy.

### Decision 2: Treat document groups as headings, not container cards

Document groups should visually read as section headings with a file name, path/root context, and count. The annotations under the document become the primary cards.

Alternative considered: keep document cards and make annotation rows lighter. That preserves the current structure, but document boundaries would still dominate the page more than the annotations themselves.

### Decision 3: Render annotations as independent cards

Each annotation should be an independent card that groups selection, quote, note, metadata, and actions. The quote should be visually distinct from the user's note, and the metadata/actions should be placed in a lower-importance footer.

Alternative considered: a compact inbox list. It would maximize density, but the user feedback points to elegance and readability, so a card flow is a better fit.

### Decision 4: Reduce action-button noise without removing actions

Open and send actions should remain per annotation, but they can be presented as lighter card actions rather than prominent table-row buttons. Batch actions remain in the toolbar.

Alternative considered: show actions only on hover. That is visually cleaner but may reduce discoverability and touch accessibility, so the first redesign should keep actions visible but subdued.

## Risks / Trade-offs

- [Risk] Card layout may reduce information density for large histories. → Mitigation: keep spacing moderate, preserve flat single-line mode for dense copying/scanning, and avoid oversized cards.
- [Risk] Moving controls within cards could break event wiring. → Mitigation: preserve existing data attributes/listeners or reattach listeners immediately after rendering, and verify selection/open/send flows.
- [Risk] Long quotes or paths can still overwhelm cards. → Mitigation: use wrapping plus sensible clamping for quote previews where appropriate, while keeping notes readable.
- [Risk] Responsive layout may regress on narrow screens. → Mitigation: update `styles/responsive.css` history rules so toolbar actions, cards, and footers stack cleanly.
