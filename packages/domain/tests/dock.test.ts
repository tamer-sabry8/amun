import { it, expect } from "vitest";
import {
  applyDock,
  createDock,
  createDockHistory,
  dockDo,
  dockPanes,
  dockRedo,
  dockUndo,
  findPane,
  paneOfTab,
  type DockSplit,
  type DockState,
} from "../src/dock.ts";

const tabs = (state: DockState) =>
  dockPanes(state.root).map((pane) => [...pane.tabs]);
const run = (state: DockState, ...ops: Parameters<typeof applyDock>[1][]) =>
  ops.reduce(applyDock, state);

it("starts with one pane, removes repeated tabs and activates the first", () => {
  const dock = createDock(["prd", "backlog", "prd"]);
  expect(tabs(dock)).toEqual([["prd", "backlog"]]);
  expect(findPane(dock, "pane-1")?.active).toBe("prd");
  expect(createDock().root).toMatchObject({ tabs: [], active: null });
});

it("opens a tab once, activating it where it already lives", () => {
  let dock = createDock(["prd"]);
  dock = applyDock(dock, { type: "open", tab: "terminal" });
  expect(tabs(dock)).toEqual([["prd", "terminal"]]);
  expect(paneOfTab(dock, "terminal")?.active).toBe("terminal");
  dock = applyDock(dock, { type: "open", tab: "prd", pane: "missing" });
  expect(tabs(dock)).toEqual([["prd", "terminal"]]);
  expect(paneOfTab(dock, "prd")?.active).toBe("prd");
  expect(applyDock(dock, { type: "open", tab: "prd" })).toBe(dock);
});

it("splits a tab into a new pane beside or before its target", () => {
  const start = createDock(["prd", "terminal", "browser"]);
  const side = applyDock(start, {
    type: "split",
    tab: "terminal",
    pane: "pane-1",
    direction: "row",
  });
  expect(tabs(side)).toEqual([["prd", "browser"], ["terminal"]]);
  expect(side.root).toMatchObject({
    type: "split",
    direction: "row",
    sizes: [0.5, 0.5],
  });
  const before = applyDock(side, {
    type: "split",
    tab: "browser",
    pane: "pane-1",
    direction: "row",
    before: true,
  });
  expect(tabs(before)).toEqual([["browser"], ["prd"], ["terminal"]]);
  const sizes = (before.root as DockSplit).sizes;
  expect(sizes).toEqual([0.25, 0.25, 0.5]);
  const nested = applyDock(side, {
    type: "split",
    tab: "browser",
    pane: "pane-1",
    direction: "column",
  });
  const root = nested.root as DockSplit;
  expect(root.children[0]).toMatchObject({
    type: "split",
    direction: "column",
  });
});

it("refuses to split a pane by its only tab", () => {
  const dock = createDock(["prd"]);
  expect(
    applyDock(dock, {
      type: "split",
      tab: "prd",
      pane: "pane-1",
      direction: "row",
    }),
  ).toBe(dock);
});

it("closing the last tab of a pane collapses its split and keeps a root pane", () => {
  let dock = run(createDock(["prd", "terminal"]), {
    type: "split",
    tab: "terminal",
    pane: "pane-1",
    direction: "row",
  });
  dock = applyDock(dock, { type: "close", tab: "terminal" });
  expect(dock.root).toMatchObject({ type: "pane", tabs: ["prd"] });
  dock = applyDock(dock, { type: "close", tab: "prd" });
  expect(dock.root).toMatchObject({ type: "pane", tabs: [], active: null });
  expect(applyDock(dock, { type: "close", tab: "prd" })).toBe(dock);
  expect(tabs(applyDock(dock, { type: "open", tab: "prs" }))).toEqual([
    ["prs"],
  ]);
});

it("closing the active tab activates its neighbour", () => {
  let dock = createDock(["a", "b", "c"]);
  dock = applyDock(dock, { type: "activate", tab: "b" });
  dock = applyDock(dock, { type: "close", tab: "b" });
  expect(findPane(dock, "pane-1")?.active).toBe("c");
  dock = applyDock(dock, { type: "close", tab: "c" });
  expect(findPane(dock, "pane-1")?.active).toBe("a");
});

it("moves a tab between panes and reorders within one, keeping tabs unique", () => {
  let dock = run(createDock(["a", "b", "c"]), {
    type: "split",
    tab: "c",
    pane: "pane-1",
    direction: "row",
  });
  const other = paneOfTab(dock, "c")!.id;
  dock = applyDock(dock, { type: "move", tab: "a", pane: other, index: 0 });
  expect(tabs(dock)).toEqual([["b"], ["a", "c"]]);
  expect(findPane(dock, other)?.active).toBe("a");
  dock = applyDock(dock, { type: "move", tab: "a", pane: other, index: 1 });
  expect(tabs(dock)).toEqual([["b"], ["c", "a"]]);
  expect(applyDock(dock, { type: "move", tab: "a", pane: other })).toBe(dock);
  expect(applyDock(dock, { type: "move", tab: "a", pane: "nope" })).toBe(dock);
  dock = applyDock(dock, { type: "move", tab: "b", pane: other });
  expect(dock.root).toMatchObject({ type: "pane", tabs: ["c", "a", "b"] });
});

it("resizes a split to normalized shares and refuses invalid or too-small ones", () => {
  const dock = run(createDock(["a", "b"]), {
    type: "split",
    tab: "b",
    pane: "pane-1",
    direction: "column",
  });
  const split = dock.root as DockSplit;
  const resized = applyDock(dock, {
    type: "resize",
    split: split.id,
    sizes: [3, 1],
  });
  expect((resized.root as DockSplit).sizes).toEqual([0.75, 0.25]);
  for (const sizes of [[1], [0, 1], [99, 1], [Number.NaN, 1]])
    expect(applyDock(dock, { type: "resize", split: split.id, sizes })).toBe(
      dock,
    );
  expect(applyDock(dock, { type: "resize", split: "x", sizes: [1, 1] })).toBe(
    dock,
  );
});

it("undo and redo restore exact states, skip no-ops and drop redo after a new change", () => {
  const first = createDock(["a", "b"]);
  let history = createDockHistory(first);
  history = dockDo(history, { type: "open", tab: "a" });
  expect(history.past).toHaveLength(0);
  history = dockDo(history, {
    type: "split",
    tab: "b",
    pane: "pane-1",
    direction: "row",
  });
  const split = history.present;
  history = dockDo(history, { type: "close", tab: "b" });
  history = dockUndo(history);
  expect(history.present).toBe(split);
  history = dockUndo(history);
  expect(history.present).toBe(first);
  expect(dockUndo(history)).toBe(history);
  history = dockRedo(history);
  expect(history.present).toBe(split);
  history = dockDo(history, { type: "open", tab: "c" });
  expect(history.future).toHaveLength(0);
  expect(dockRedo(history)).toBe(history);
});
