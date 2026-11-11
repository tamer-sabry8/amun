# ADR-012: Widget registry and dock layout

Status: proposed — foundation only, not yet wired into the shell
Milestone: R2 preparation

## Decision and user benefit

Dynamic surfaces (plan §5.6) are declared as **widget kinds** instead of being hardcoded per screen. A kind names its slot (`island`, `activity`, `notifications`, `inline`, `toast`), a schema for its data, its title and the actions a person may take. A renderer is registered separately under the same kind key; a kind without one uses a plain card. New widgets can then be added without editing the shell.

Panels use a **dock layout**: a tree of splits whose leaves are tabbed panes, changed only through pure operations (`open`, `close`, `activate`, `move`, `split`, `resize`) with undo and redo over state history.

## Rules

- The registry performs no external write. Acting on a widget returns an intent; the caller routes it through the existing approval and connector path.
- Proposals are validated against the kind schema. Unknown kinds, invalid data and repeated ids are refused.
- Requests (attention items) map to island kinds that cannot be dismissed; they leave only when their own flow resolves them.
- Widgets are product-scoped. An exclusive kind replaces its earlier open widget within the same product only.
- When a kind is removed its widgets stay readable and dismissible; other actions are refused until it returns.

## Scope and remaining work

Added: `packages/domain/src/widgets.ts`, `dock.ts`, `attention-widgets.ts` and `apps/renderer/src/widget-host.tsx`, with unit tests. No existing file, schema, style or dependency changed.

Not done: the shell still renders the Island and drawers directly. Wiring the registry and dock into `shell.tsx` changes visible layout and belongs with the T022c redesign, which needs owner approval. No packaged Mac, accessibility or performance evidence exists for these modules yet.
