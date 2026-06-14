## 1. Header Structure

- [x] 1.1 Restructure the viewer header into an identity row and contextual toolbar row.
- [x] 1.2 Move the Markdown/AI Terminal module switch into the identity row as global navigation.
- [x] 1.3 Move annotation history out of the raw/AI document view switch and expose it as a Markdown toolbar action.
- [x] 1.4 Remove the top scroll button from the primary header controls while preserving existing contextual scroll affordances.

## 2. Contextual Controls

- [x] 2.1 Keep Markdown-only controls visible in the Markdown toolbar and hidden in terminal mode.
- [x] 2.2 Keep terminal-only controls visible in the terminal toolbar and hidden in Markdown mode.
- [x] 2.3 Compact the automatic comment dispatch control while preserving its existing checkbox state and persistence.
- [x] 2.4 Keep Agent availability visible in the header identity row with accessible status text and constrained long labels.

## 3. Styling And Responsiveness

- [x] 3.1 Update desktop header layout, spacing, and control grouping to reduce visual clutter.
- [x] 3.2 Update mobile/narrow viewport behavior so header controls wrap or stack without overlap.
- [x] 3.3 Ensure content empty-state height still accounts for the taller header.

## 4. Verification

- [x] 4.1 Run static JavaScript syntax checks for changed modules.
- [x] 4.2 Verify the local app loads without console errors.
- [x] 4.3 Inspect desktop and narrow viewport header rendering.
