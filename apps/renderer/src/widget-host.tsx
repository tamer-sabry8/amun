import { useSyncExternalStore, type ReactElement } from "react";
import type {
  Widget,
  WidgetActionSpec,
  WidgetIntent,
  WidgetRegistry,
  WidgetSlot as SlotName,
} from "../../../packages/domain/src/widgets.ts";

export interface WidgetRenderProps {
  widget: Widget;
  actions: readonly WidgetActionSpec[];
  /** Records the choice in the registry and reports the resulting intent. */
  act(action: string): void;
}

export type WidgetRenderer = (props: WidgetRenderProps) => ReactElement | null;

/** Renderers keyed by widget kind. A kind without one uses the plain card. */
export class WidgetRenderers {
  private readonly renderers = new Map<string, WidgetRenderer>();

  register(kind: string, renderer: WidgetRenderer): () => void {
    if (this.renderers.has(kind))
      throw new Error("Widget renderer already registered: " + kind);
    this.renderers.set(kind, renderer);
    return () => {
      if (this.renderers.get(kind) === renderer) this.renderers.delete(kind);
    };
  }

  resolve(kind: string): WidgetRenderer {
    return this.renderers.get(kind) ?? PlainWidget;
  }

  has(kind: string): boolean {
    return this.renderers.has(kind);
  }
}

/** Fallback card: the title and one button per available action. */
export function PlainWidget({ widget, actions, act }: WidgetRenderProps) {
  return (
    <article
      className={"widget widget-" + widget.slot}
      data-widget-id={widget.id}
      data-widget-kind={widget.kind}
    >
      <p className="widget-title">{widget.title}</p>
      {!widget.available && (
        <p className="muted">This item is no longer available.</p>
      )}
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className={action.primary ? "primary" : "text-button"}
          onClick={() => act(action.id)}
        >
          {action.label}
        </button>
      ))}
    </article>
  );
}

interface SlotProps {
  registry: WidgetRegistry;
  renderers: WidgetRenderers;
  slot: SlotName;
  productId?: string;
  label: string;
  onIntent?(intent: WidgetIntent): void;
}

/** Renders the open widgets of one slot and keeps them current. */
export function WidgetSlot({
  registry,
  renderers,
  slot,
  productId,
  label,
  onIntent,
}: SlotProps) {
  useSyncExternalStore(
    (listener) => registry.subscribe(listener),
    () => registry.version(),
    () => registry.version(),
  );
  const widgets = registry.list(
    productId === undefined ? { slot } : { slot, productId },
  );
  return (
    <section
      className={"widget-slot widget-slot-" + slot}
      aria-label={label}
      data-widget-slot={slot}
      data-count={widgets.length}
    >
      {widgets.map((widget) => {
        const Renderer = renderers.resolve(widget.kind);
        return (
          <Renderer
            key={widget.id}
            widget={widget}
            actions={registry.actions(widget.id)}
            act={(action) => {
              const result = registry.act(widget.id, action);
              if (result.ok) onIntent?.(result.intent);
            }}
          />
        );
      })}
    </section>
  );
}
