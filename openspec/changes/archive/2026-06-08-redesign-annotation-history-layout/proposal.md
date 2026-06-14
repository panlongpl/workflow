## Why

The current history annotations page presents useful data, but its nested bordered sections and table-like rows make the experience feel visually heavy and hard to scan. As annotation review and Agent dispatch become more central workflows, the page should feel like a focused reading inbox rather than an admin table.

## What Changes

- Redesign the history annotations page into a lighter reading-oriented card flow.
- Keep existing behaviors: grouped view, flat single-line view, selection, open, send, send selected, and copy all.
- Make the header a compact toolbar that separates page identity, count, mode switching, and batch actions.
- Make document groups visually lighter, using section headings rather than heavy nested cards.
- Render each annotation as an independent card with clearer quote, note, metadata, selection, and action regions.
- Reduce visual noise from repeated borders and always-prominent row actions.
- No data model, storage, API, or Agent dispatch protocol changes are intended.

## Capabilities

### New Capabilities
- `annotation-history-layout`: Covers the visual structure and interaction presentation of the annotation history page, including toolbar, grouped document headings, annotation cards, and flat view continuity.

### Modified Capabilities

None.

## Impact

- Affected frontend rendering: `src/history.js`.
- Affected styling: `styles/history.css` and responsive history-related rules in `styles/responsive.css` if needed.
- Existing history state management in `src/app.js` should remain behaviorally unchanged except for wiring required by revised markup.
- No backend, persistence, or dependency changes expected.
