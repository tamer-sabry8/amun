import { it, expect, vi } from "vitest";
import {
  WidgetRegistry,
  dismissAction,
  type WidgetKind,
  type WidgetSchema,
} from "../src/widgets.ts";

interface Note {
  text: string;
}
const noteSchema: WidgetSchema<Note> = {
  safeParse(input) {
    return input &&
      typeof input === "object" &&
      "text" in input &&
      typeof input.text === "string" &&
      input.text.length > 0
      ? { success: true, data: { text: input.text } }
      : { success: false, error: new Error("text required") };
  },
};
const note = (changes: Partial<WidgetKind<Note>> = {}): WidgetKind<Note> => ({
  kind: "note",
  slot: "activity",
  schema: noteSchema,
  title: (data) => "Note · " + data.text,
  actions: [
    { id: "open", label: "Open", primary: true },
    { id: "finish", label: "Finish", closes: true },
  ],
  ...changes,
});
const propose = (registry: WidgetRegistry, id: string, text = "hello") =>
  registry.propose({ id, kind: "note", productId: "p", data: { text } });

it("rejects repeated kinds, unknown slots, blank names and reserved or repeated actions", () => {
  const registry = new WidgetRegistry();
  registry.register(note());
  expect(() => registry.register(note())).toThrow(/already registered/);
  expect(() => registry.register(note({ kind: " " }))).toThrow(/name/);
  expect(() =>
    registry.register(note({ kind: "bad", slot: "nowhere" as never })),
  ).toThrow(/slot/);
  expect(() =>
    registry.register(
      note({ kind: "x", actions: [{ id: dismissAction, label: "No" }] }),
    ),
  ).toThrow(/reserved/);
  expect(() =>
    registry.register(
      note({
        kind: "y",
        actions: [
          { id: "a", label: "A" },
          { id: "a", label: "B" },
        ],
      }),
    ),
  ).toThrow(/repeated/);
});

it("validates proposals against the kind schema and refuses unknown kinds and repeated ids", () => {
  const registry = new WidgetRegistry();
  expect(propose(registry, "1")).toEqual({ ok: false, reason: "unknown_kind" });
  registry.register(note());
  expect(
    registry.propose({ id: "1", kind: "note", productId: "p", data: {} }),
  ).toEqual({ ok: false, reason: "invalid_data" });
  const accepted = propose(registry, "1");
  expect(accepted.ok && accepted.widget).toMatchObject({
    id: "1",
    slot: "activity",
    title: "Note · hello",
    state: "open",
    available: true,
  });
  expect(propose(registry, "1")).toEqual({ ok: false, reason: "duplicate_id" });
  expect(registry.list()).toHaveLength(1);
});

it("lists open widgets by priority then proposal order, filtered by slot and product", () => {
  const registry = new WidgetRegistry();
  registry.register(note());
  registry.register(note({ kind: "urgent", slot: "island", priority: 1 }));
  registry.register(note({ kind: "late", slot: "island", priority: 200 }));
  registry.propose({
    id: "c",
    kind: "late",
    productId: "p",
    data: { text: "c" },
  });
  registry.propose({
    id: "a",
    kind: "urgent",
    productId: "p",
    data: { text: "a" },
  });
  registry.propose({
    id: "b",
    kind: "urgent",
    productId: "p",
    data: { text: "b" },
  });
  registry.propose({
    id: "o",
    kind: "urgent",
    productId: "q",
    data: { text: "o" },
  });
  propose(registry, "n");
  expect(
    registry.list({ slot: "island", productId: "p" }).map((w) => w.id),
  ).toEqual(["a", "b", "c"]);
  expect(registry.list({ slot: "activity" }).map((w) => w.id)).toEqual(["n"]);
  expect(registry.list({ productId: "q" }).map((w) => w.id)).toEqual(["o"]);
});

it("returns an intent without closing, closes on a closing action, and refuses further actions", () => {
  const registry = new WidgetRegistry();
  registry.register(note());
  propose(registry, "1");
  expect(registry.act("missing", "open")).toEqual({
    ok: false,
    reason: "unknown_widget",
  });
  expect(registry.act("1", "nope")).toEqual({
    ok: false,
    reason: "unknown_action",
  });
  expect(registry.act("1", "open")).toEqual({
    ok: true,
    intent: {
      widgetId: "1",
      kind: "note",
      productId: "p",
      action: "open",
      data: { text: "hello" },
    },
  });
  expect(registry.get("1")?.state).toBe("open");
  expect(registry.act("1", "finish").ok).toBe(true);
  expect(registry.get("1")?.state).toBe("done");
  expect(registry.act("1", "open")).toEqual({ ok: false, reason: "closed" });
  expect(registry.list()).toEqual([]);
  expect(registry.list({ includeClosed: true })).toHaveLength(1);
  expect(registry.actions("1")).toEqual([]);
});

it("offers dismissal unless the kind turns it off", () => {
  const registry = new WidgetRegistry();
  registry.register(note());
  registry.register(note({ kind: "sticky", dismissible: false }));
  propose(registry, "1");
  registry.propose({
    id: "2",
    kind: "sticky",
    productId: "p",
    data: { text: "s" },
  });
  expect(registry.actions("1").map((a) => a.id)).toEqual([
    "open",
    "finish",
    dismissAction,
  ]);
  expect(registry.actions("2").map((a) => a.id)).toEqual(["open", "finish"]);
  expect(registry.act("2", dismissAction)).toEqual({
    ok: false,
    reason: "unknown_action",
  });
  expect(registry.act("1", dismissAction).ok).toBe(true);
  expect(registry.get("1")?.state).toBe("dismissed");
});

it("an exclusive kind replaces its earlier open widget within the same product only", () => {
  const registry = new WidgetRegistry();
  registry.register(note({ exclusive: true }));
  propose(registry, "1");
  registry.propose({
    id: "other",
    kind: "note",
    productId: "q",
    data: { text: "o" },
  });
  propose(registry, "2");
  expect(registry.get("1")?.state).toBe("replaced");
  expect(registry.get("other")?.state).toBe("open");
  expect(registry.list({ productId: "p" }).map((w) => w.id)).toEqual(["2"]);
  expect(registry.act("1", "open")).toEqual({ ok: false, reason: "closed" });
});

it("keeps widgets of a removed kind readable, dismissible and otherwise unavailable until it returns", () => {
  const registry = new WidgetRegistry();
  const dispose = registry.register(note());
  propose(registry, "1");
  propose(registry, "2");
  dispose();
  dispose();
  expect(registry.has("note")).toBe(false);
  expect(registry.get("1")?.available).toBe(false);
  expect(registry.act("1", "open")).toEqual({
    ok: false,
    reason: "unavailable",
  });
  expect(registry.actions("1").map((a) => a.id)).toEqual([dismissAction]);
  expect(registry.act("1", dismissAction).ok).toBe(true);
  registry.register(note());
  expect(registry.get("2")?.available).toBe(true);
  expect(registry.act("2", "open").ok).toBe(true);
});

it("notifies subscribers and advances the version on every change, and stops after unsubscribe", () => {
  const registry = new WidgetRegistry();
  const listener = vi.fn();
  const unsubscribe = registry.subscribe(listener);
  const start = registry.version();
  registry.register(note());
  propose(registry, "1");
  registry.act("1", "open");
  expect(listener).toHaveBeenCalledTimes(2);
  registry.act("1", "finish");
  expect(registry.remove("1")).toBe(true);
  expect(registry.remove("1")).toBe(false);
  expect(listener).toHaveBeenCalledTimes(4);
  expect(registry.version()).toBe(start + 4);
  unsubscribe();
  propose(registry, "2");
  expect(listener).toHaveBeenCalledTimes(4);
});
