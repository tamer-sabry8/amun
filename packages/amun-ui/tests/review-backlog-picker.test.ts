// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { bridge } from "../src/bridge.ts";
import { readBoard, readSource } from "../src/backlog-selection.ts";
import { ReviewBacklogPicker } from "../src/rebuild/review-backlog-picker.tsx";
it("previews candidate backlogs and changes a default only on explicit selection", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const host = document.createElement("div"),
    root = createRoot(host);
  const listeners = new Set<(event: unknown) => void>();
  vi.spyOn(bridge, "onEvent").mockImplementation((fn) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  });
  const send = vi.spyOn(bridge, "send").mockImplementation((raw) => {
    const m = raw as { action: string; requestId: string; productId: string };
    const result =
      m.action === "teams"
        ? { view: "teams", teams: [{ id: "T", name: "Team" }] }
        : m.action === "options"
          ? {
              view: "options",
              levels: [
                { id: "A", name: "A" },
                { id: "B", name: "B" },
              ],
            }
          : { view: "cards", cards: [], columns: [], canEditBoard: false };
    queueMicrotask(() =>
      listeners.forEach((fn) =>
        fn({
          kind: "backlog-result",
          productId: m.productId,
          requestId: m.requestId,
          ...result,
        }),
      ),
    );
  });
  const choose = vi.fn();
  async function select(n: number, v: string) {
    await act(() => {
      const el = host.querySelectorAll("select")[n]!;
      el.value = v;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  try {
    await act(() =>
      root.render(
        createElement(ReviewBacklogPicker, {
          productId: "p",
          sources: [{ id: "s", title: "Project" }],
          choose,
        }),
      ),
    );
    await select(0, "s");
    await select(1, "T");
    await select(2, "A");
    await select(2, "B");
    expect(host.textContent).toContain("0 readable items");
    await act(() => host.querySelectorAll("button")[0]!.click());
    expect(choose).toHaveBeenLastCalledWith({
      sourceId: "s",
      team: "T",
      level: "B",
    });
    expect(readSource(localStorage, "p", ["s"])).toBe("");
    await act(() => host.querySelectorAll("button")[1]!.click());
    expect(readBoard(localStorage, "p", "s")).toEqual({
      team: "T",
      level: "B",
    });
    expect(
      send.mock.calls.every(
        ([m]) => (m as { kind: string }).kind === "backlog-read",
      ),
    ).toBe(true);
  } finally {
    await act(() => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
