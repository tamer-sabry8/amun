/**
 * Widget registry: a widget kind declares where it appears, the shape of its
 * data and the actions a person may take. Hosts propose widget instances and
 * render them through a renderer registered under the same kind key.
 *
 * The registry never performs external writes. Acting on a widget returns an
 * intent; the caller routes it through the usual approval and connector path.
 */

export const widgetSlots = [
  "island",
  "activity",
  "notifications",
  "inline",
  "toast",
] as const;
export type WidgetSlot = (typeof widgetSlots)[number];

/** Structural schema contract. A zod schema satisfies it without an import. */
export interface WidgetSchema<T> {
  safeParse(
    input: unknown,
  ): { success: true; data: T } | { success: false; error: unknown };
}

export interface WidgetActionSpec {
  id: string;
  label: string;
  /** The widget leaves its slot once this action is taken. */
  closes?: boolean;
  primary?: boolean;
}

export interface WidgetKind<T = unknown> {
  kind: string;
  slot: WidgetSlot;
  schema: WidgetSchema<T>;
  /** Short label for the compact form, for example "Decide · Invitation expiry". */
  title(data: T): string;
  actions?: readonly WidgetActionSpec[];
  /** Lower numbers are listed first. Defaults to 100. */
  priority?: number;
  /**
   * A newer open widget of this kind, in the same product, replaces earlier
   * open ones. Use it for surfaces that show a single current item.
   */
  exclusive?: boolean;
  /** Dismissal is offered unless the kind turns it off. */
  dismissible?: boolean;
}

export type WidgetState = "open" | "done" | "dismissed" | "replaced";

export interface Widget<T = unknown> {
  id: string;
  kind: string;
  slot: WidgetSlot;
  productId: string;
  title: string;
  data: T;
  state: WidgetState;
  priority: number;
  /** Monotonic insertion order within one registry. */
  sequence: number;
  /** False while the kind that owns this widget is not registered. */
  available: boolean;
}

export interface WidgetProposal {
  id: string;
  kind: string;
  productId: string;
  data: unknown;
}

export type ProposeFailure = "unknown_kind" | "invalid_data" | "duplicate_id";
export type ProposeResult =
  { ok: true; widget: Widget } | { ok: false; reason: ProposeFailure };

export interface WidgetIntent {
  widgetId: string;
  kind: string;
  productId: string;
  action: string;
  data: unknown;
}

export type ActFailure =
  "unknown_widget" | "closed" | "unavailable" | "unknown_action";
export type ActResult =
  { ok: true; intent: WidgetIntent } | { ok: false; reason: ActFailure };

export const dismissAction = "dismiss";
const defaultPriority = 100;

export interface WidgetQuery {
  slot?: WidgetSlot;
  productId?: string;
  /** Include widgets that are no longer open. Defaults to false. */
  includeClosed?: boolean;
}

export class WidgetRegistry {
  private readonly kinds = new Map<string, WidgetKind>();
  private readonly widgets = new Map<string, Widget>();
  private readonly listeners = new Set<() => void>();
  private sequence = 0;
  private revision = 0;

  /** Registers a kind and returns a disposer that removes it again. */
  register<T>(kind: WidgetKind<T>): () => void {
    if (!kind.kind.trim()) throw new Error("Widget kind needs a name");
    if (!widgetSlots.includes(kind.slot))
      throw new Error("Unknown widget slot: " + String(kind.slot));
    if (this.kinds.has(kind.kind))
      throw new Error("Widget kind already registered: " + kind.kind);
    const ids = new Set<string>();
    for (const action of kind.actions ?? []) {
      if (action.id === dismissAction || ids.has(action.id))
        throw new Error("Widget action is reserved or repeated: " + action.id);
      ids.add(action.id);
    }
    this.kinds.set(kind.kind, kind as unknown as WidgetKind);
    this.setAvailability(kind.kind, true);
    this.changed();
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      this.kinds.delete(kind.kind);
      this.setAvailability(kind.kind, false);
      this.changed();
    };
  }

  has(kind: string): boolean {
    return this.kinds.has(kind);
  }

  kind(kind: string): WidgetKind | undefined {
    return this.kinds.get(kind);
  }

  /** Validates the data against the kind schema and adds an open widget. */
  propose(proposal: WidgetProposal): ProposeResult {
    const kind = this.kinds.get(proposal.kind);
    if (!kind) return { ok: false, reason: "unknown_kind" };
    if (this.widgets.has(proposal.id))
      return { ok: false, reason: "duplicate_id" };
    const parsed = kind.schema.safeParse(proposal.data);
    if (!parsed.success) return { ok: false, reason: "invalid_data" };
    if (kind.exclusive)
      for (const [id, existing] of this.widgets)
        if (
          existing.kind === kind.kind &&
          existing.productId === proposal.productId &&
          existing.state === "open"
        )
          this.widgets.set(id, { ...existing, state: "replaced" });
    const widget: Widget = {
      id: proposal.id,
      kind: kind.kind,
      slot: kind.slot,
      productId: proposal.productId,
      title: kind.title(parsed.data),
      data: parsed.data,
      state: "open",
      priority: kind.priority ?? defaultPriority,
      sequence: ++this.sequence,
      available: true,
    };
    this.widgets.set(widget.id, widget);
    this.changed();
    return { ok: true, widget };
  }

  /**
   * Records a person's choice and returns the intent for the caller to carry
   * out. Dismissal still works for a widget whose kind was removed.
   */
  act(widgetId: string, action: string): ActResult {
    const widget = this.widgets.get(widgetId);
    if (!widget) return { ok: false, reason: "unknown_widget" };
    if (widget.state !== "open") return { ok: false, reason: "closed" };
    const kind = this.kinds.get(widget.kind);
    const intent: WidgetIntent = {
      widgetId,
      kind: widget.kind,
      productId: widget.productId,
      action,
      data: widget.data,
    };
    if (action === dismissAction) {
      if (kind && kind.dismissible === false)
        return { ok: false, reason: "unknown_action" };
      this.widgets.set(widgetId, { ...widget, state: "dismissed" });
      this.changed();
      return { ok: true, intent };
    }
    if (!kind) return { ok: false, reason: "unavailable" };
    const spec = kind.actions?.find((candidate) => candidate.id === action);
    if (!spec) return { ok: false, reason: "unknown_action" };
    if (spec.closes) {
      this.widgets.set(widgetId, { ...widget, state: "done" });
      this.changed();
    }
    return { ok: true, intent };
  }

  /** Removes a widget, for example once its source record is resolved. */
  remove(widgetId: string): boolean {
    const removed = this.widgets.delete(widgetId);
    if (removed) this.changed();
    return removed;
  }

  get(widgetId: string): Widget | undefined {
    return this.widgets.get(widgetId);
  }

  /** Widgets ordered by priority, then by the order they were proposed. */
  list(query: WidgetQuery = {}): Widget[] {
    return [...this.widgets.values()]
      .filter(
        (widget) =>
          (query.includeClosed || widget.state === "open") &&
          (query.slot === undefined || widget.slot === query.slot) &&
          (query.productId === undefined ||
            widget.productId === query.productId),
      )
      .sort(
        (left, right) =>
          left.priority - right.priority || left.sequence - right.sequence,
      );
  }

  /** Actions a person can take on a widget right now, dismissal included. */
  actions(widgetId: string): WidgetActionSpec[] {
    const widget = this.widgets.get(widgetId);
    if (!widget || widget.state !== "open") return [];
    const kind = this.kinds.get(widget.kind);
    const dismiss: WidgetActionSpec = {
      id: dismissAction,
      label: "Not now",
      closes: true,
    };
    if (!kind) return [dismiss];
    return kind.dismissible === false
      ? [...(kind.actions ?? [])]
      : [...(kind.actions ?? []), dismiss];
  }

  /** Changes on every mutation, so stores can detect updates cheaply. */
  version(): number {
    return this.revision;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setAvailability(kind: string, available: boolean): void {
    for (const [id, widget] of this.widgets)
      if (widget.kind === kind && widget.available !== available)
        this.widgets.set(id, { ...widget, available });
  }

  private changed(): void {
    this.revision += 1;
    for (const listener of [...this.listeners]) listener();
  }
}
