import {
  attentionItem,
  type AttentionItem,
} from "../../contracts/src/entities.ts";
import {
  WidgetRegistry,
  type ProposeResult,
  type WidgetKind,
} from "./widgets.ts";

type AttentionType = AttentionItem["type"];

/** Island order from the product plan: what blocks the crew comes first. */
const order: Record<AttentionType, number> = {
  unblock: 0,
  approve: 20,
  reconnect: 30,
  resolve_conflict: 30,
  decide: 40,
  answer: 40,
  review: 40,
  apply: 50,
  create: 50,
  go_to: 60,
};

const labels: Record<AttentionType, string> = {
  unblock: "Unblock",
  answer: "Answer",
  decide: "Decide",
  approve: "Approve",
  review: "Review",
  apply: "Apply",
  create: "Create",
  go_to: "Next",
  reconnect: "Reconnect",
  resolve_conflict: "Resolve conflict",
};

export const openAction = "open";

export function attentionKindKey(type: AttentionType): string {
  return "attention." + type;
}

function typedSchema(type: AttentionType): WidgetKind<AttentionItem>["schema"] {
  return {
    safeParse(input) {
      const parsed = attentionItem.safeParse(input);
      if (!parsed.success) return { success: false, error: parsed.error };
      if (parsed.data.type !== type)
        return { success: false, error: new Error("Wrong request type") };
      return { success: true, data: parsed.data };
    },
  };
}

/** One island widget kind per request type a person can be asked for. */
export function attentionKinds(): WidgetKind<AttentionItem>[] {
  return (Object.keys(order) as AttentionType[]).map((type) => ({
    kind: attentionKindKey(type),
    slot: "island" as const,
    schema: typedSchema(type),
    priority: order[type],
    title: (item) => labels[type] + " · " + item.origin.label,
    actions: [{ id: openAction, label: "Open", primary: true }],
    // Requests stay until their own flow resolves them.
    dismissible: false,
  }));
}

/** Registers every request kind and returns one disposer for all of them. */
export function registerAttentionKinds(registry: WidgetRegistry): () => void {
  const disposers = attentionKinds().map((kind) => registry.register(kind));
  return () => {
    for (const dispose of disposers) dispose();
  };
}

/** Proposes the island widget for one request, keyed by the request id. */
export function proposeAttention(
  registry: WidgetRegistry,
  item: AttentionItem,
): ProposeResult {
  return registry.propose({
    id: item.id,
    kind: attentionKindKey(item.type),
    productId: item.productId,
    data: item,
  });
}
