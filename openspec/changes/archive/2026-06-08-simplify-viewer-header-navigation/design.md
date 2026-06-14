## Context

The app currently renders the viewer header as a three-column grid: document identity on the left, module and Markdown controls in the center, and Agent/tools/status on the right. As features accumulated, the center and right columns began competing for the same horizontal space. The result is a crowded header where global module navigation, document view selection, AI reading configuration, Agent availability, automatic comment dispatch, terminal actions, and scroll controls all appear at the same visual level.

The app is a local, work-focused Markdown reader with AI terminal integration. The header should support repeated scanning and quick action rather than marketing-style navigation or explanatory text.

## Goals / Non-Goals

**Goals:**

- Separate document identity from contextual tools.
- Move global Markdown/AI Terminal navigation out of the crowded center header.
- Keep Markdown controls visible, compact, and grouped by workflow.
- Show terminal controls only when the terminal module is active.
- Preserve current feature behavior: Markdown views, AI reading mode, annotation history, automatic comment dispatch preference, Agent availability, and terminal actions.
- Maintain responsive behavior without overlapping controls or clipped important text.

**Non-Goals:**

- Redesign the sidebar file tree, annotation drawer, history page content, or terminal internals.
- Change backend APIs, annotation persistence, Agent launch behavior, or dispatch semantics.
- Add new dependencies or introduce a full design-system rewrite.

## Decisions

### Use a two-row viewer header

The viewer header will be organized as:

- Header identity row: document/module title, path/status metadata, compact module switch, and compact Agent availability.
- Header toolbar row: contextual actions for the active module.

This separates "where am I?" from "what can I do here?" while keeping the controls near the content they affect.

Alternative considered: keep a single row and shrink labels. This would reduce width pressure but keep unrelated controls at the same hierarchy, so it does not solve the underlying information architecture problem.

### Move module navigation into a global switch

The Markdown/AI Terminal switch will no longer sit in the center of the same row as Markdown view controls. It will become a compact global module switch in the identity row, visually separate from document view controls.

Alternative considered: move module navigation into the sidebar. That is a strong long-term direction, but it would require reworking sidebar semantics and mobile behavior. The compact identity-row switch gives most of the hierarchy improvement with less disruption.

### Treat annotation history as a contextual action, not a document view tab

The raw rendered Markdown and AI reading output are alternative views of the current document. Annotation history is a global annotation management page. It will be presented as an action in the Markdown toolbar rather than as a peer tab in the document view switch.

Alternative considered: keep `历史注释` inside the segmented view control. This preserves the current DOM shape but continues to imply that history is a current-document rendering mode.

### Compact long settings into task-oriented controls

The automatic comment dispatch preference will remain visible in the Markdown toolbar, but use short text such as `自动派发` instead of the full sentence. The existing input and persistence behavior remain unchanged.

The Agent availability indicator remains in the header, with its title/accessible label preserving detailed state. The visual label should stay short enough to scan.

### Keep transient movement out of the primary header

The `顶部` scroll action will be removed from the primary header controls. Scrolling remains available through existing floating/contextual controls where appropriate.

## Risks / Trade-offs

- Header restructuring can regress mobile layout -> Use wrapping toolbar rows and responsive single-column stacking at narrow widths.
- Moving history out of the view switch may make it feel less discoverable for users familiar with the current tabs -> Keep the action visible in the Markdown toolbar and preserve the same click behavior.
- Compact labels can reduce clarity -> Retain accessible labels, titles, and recognizable grouping so short visible text remains understandable.
- The app has mostly static HTML/CSS rather than componentized UI -> Keep DOM changes scoped to the existing header and state toggles instead of introducing a new abstraction layer.
