/**
 * Dock layout: a tree of splits whose leaves are tabbed panes. Every change
 * is a pure operation on an immutable state, so a history of states gives
 * undo and redo without bespoke inverse logic per operation.
 */

export type DockDirection = "row" | "column";

export interface DockPane {
  type: "pane";
  id: string;
  tabs: readonly string[];
  active: string | null;
}

export interface DockSplit {
  type: "split";
  id: string;
  direction: DockDirection;
  children: readonly DockNode[];
  /** Fractions of the split, one per child, summing to 1. */
  sizes: readonly number[];
}

export type DockNode = DockPane | DockSplit;

export interface DockState {
  root: DockNode;
  /** Counter for generated pane and split identifiers. */
  next: number;
}

export type DockOp =
  | { type: "open"; tab: string; pane?: string }
  | { type: "close"; tab: string }
  | { type: "activate"; tab: string }
  | { type: "move"; tab: string; pane: string; index?: number }
  | {
      type: "split";
      tab: string;
      pane: string;
      direction: DockDirection;
      /** Place the new pane before the target instead of after it. */
      before?: boolean;
    }
  | { type: "resize"; split: string; sizes: readonly number[] };

export const minimumShare = 0.1;

export function createDock(tabs: readonly string[] = []): DockState {
  const unique = [...new Set(tabs)];
  return {
    root: {
      type: "pane",
      id: "pane-1",
      tabs: unique,
      active: unique[0] ?? null,
    },
    next: 2,
  };
}

export function dockPanes(node: DockNode): DockPane[] {
  return node.type === "pane" ? [node] : node.children.flatMap(dockPanes);
}

export function findPane(state: DockState, id: string): DockPane | undefined {
  return dockPanes(state.root).find((pane) => pane.id === id);
}

export function paneOfTab(state: DockState, tab: string): DockPane | undefined {
  return dockPanes(state.root).find((pane) => pane.tabs.includes(tab));
}

function even(count: number): number[] {
  return Array.from({ length: count }, () => 1 / count);
}

function normalizeSizes(sizes: readonly number[], count: number): number[] {
  if (
    sizes.length !== count ||
    sizes.some((size) => !Number.isFinite(size) || size <= 0)
  )
    return even(count);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return sizes.map((size) => size / total);
}

function mapPanes(
  node: DockNode,
  change: (pane: DockPane) => DockPane,
): DockNode {
  if (node.type === "pane") return change(node);
  return {
    ...node,
    children: node.children.map((child) => mapPanes(child, change)),
  };
}

/** Drops empty panes, flattens single-child and same-direction splits. */
function tidy(node: DockNode, isRoot: boolean): DockNode | null {
  if (node.type === "pane") {
    if (node.tabs.length === 0)
      return isRoot ? { ...node, active: null } : null;
    const active =
      node.active !== null && node.tabs.includes(node.active)
        ? node.active
        : (node.tabs[0] ?? null);
    return active === node.active ? node : { ...node, active };
  }
  const children: DockNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, index) => {
    const kept = tidy(child, false);
    if (!kept) return;
    const share = node.sizes[index] ?? 1 / node.children.length;
    if (kept.type === "split" && kept.direction === node.direction) {
      kept.children.forEach((grandchild, inner) => {
        children.push(grandchild);
        sizes.push(share * (kept.sizes[inner] ?? 1 / kept.children.length));
      });
    } else {
      children.push(kept);
      sizes.push(share);
    }
  });
  if (children.length === 0)
    return isRoot
      ? { type: "pane", id: "pane-1", tabs: [], active: null }
      : null;
  if (children.length === 1) return children[0] ?? null;
  return { ...node, children, sizes: normalizeSizes(sizes, children.length) };
}

function finish(state: DockState, root: DockNode): DockState {
  return { ...state, root: tidy(root, true) ?? createDock().root };
}

function withoutTab(node: DockNode, tab: string): DockNode {
  return mapPanes(node, (pane) => {
    if (!pane.tabs.includes(tab)) return pane;
    const index = pane.tabs.indexOf(tab);
    const tabs = pane.tabs.filter((candidate) => candidate !== tab);
    const active =
      pane.active === tab
        ? (tabs[Math.min(index, tabs.length - 1)] ?? null)
        : pane.active;
    return { ...pane, tabs, active };
  });
}

function insertTab(
  node: DockNode,
  paneId: string,
  tab: string,
  index?: number,
): DockNode {
  return mapPanes(node, (pane) => {
    if (pane.id !== paneId) return pane;
    const tabs = [...pane.tabs];
    const at =
      index === undefined
        ? tabs.length
        : Math.max(0, Math.min(Math.trunc(index), tabs.length));
    tabs.splice(at, 0, tab);
    return { ...pane, tabs, active: tab };
  });
}

function splitPane(
  node: DockNode,
  paneId: string,
  created: DockPane,
  splitId: string,
  direction: DockDirection,
  before: boolean,
): DockNode {
  if (node.type === "pane") {
    if (node.id !== paneId) return node;
    return {
      type: "split",
      id: splitId,
      direction,
      children: before ? [created, node] : [node, created],
      sizes: [0.5, 0.5],
    };
  }
  const at = node.children.findIndex(
    (child) => child.type === "pane" && child.id === paneId,
  );
  if (at >= 0 && node.direction === direction) {
    // Share the target's space with the new sibling in the same split.
    const share = (node.sizes[at] ?? 1 / node.children.length) / 2;
    const children = [...node.children];
    const sizes = [...node.sizes];
    children.splice(before ? at : at + 1, 0, created);
    sizes.splice(at, 1, share, share);
    return { ...node, children, sizes };
  }
  return {
    ...node,
    children: node.children.map((child) =>
      splitPane(child, paneId, created, splitId, direction, before),
    ),
  };
}

function resizeSplit(
  node: DockNode,
  splitId: string,
  sizes: readonly number[],
): DockNode {
  if (node.type === "pane") return node;
  if (node.id === splitId) {
    if (
      sizes.length !== node.children.length ||
      sizes.some((size) => !Number.isFinite(size) || size <= 0)
    )
      return node;
    const normalized = normalizeSizes(sizes, sizes.length);
    if (normalized.some((size) => size < minimumShare)) return node;
    return { ...node, sizes: normalized };
  }
  const children = node.children.map((child) =>
    resizeSplit(child, splitId, sizes),
  );
  return children.every((child, index) => child === node.children[index])
    ? node
    : { ...node, children };
}

/**
 * Applies one operation. An operation that names a missing pane, tab or
 * split, or that would break an invariant, returns the same state object.
 */
export function applyDock(state: DockState, op: DockOp): DockState {
  if (op.type === "open") {
    const current = paneOfTab(state, op.tab);
    if (current)
      return current.active === op.tab
        ? state
        : applyDock(state, { type: "activate", tab: op.tab });
    const target =
      (op.pane === undefined ? undefined : findPane(state, op.pane)) ??
      dockPanes(state.root)[0];
    if (!target) return state;
    return finish(state, insertTab(state.root, target.id, op.tab));
  }
  if (op.type === "close") {
    if (!paneOfTab(state, op.tab)) return state;
    return finish(state, withoutTab(state.root, op.tab));
  }
  if (op.type === "activate") {
    const pane = paneOfTab(state, op.tab);
    if (!pane || pane.active === op.tab) return state;
    return finish(
      state,
      mapPanes(state.root, (candidate) =>
        candidate.id === pane.id ? { ...candidate, active: op.tab } : candidate,
      ),
    );
  }
  if (op.type === "move") {
    const source = paneOfTab(state, op.tab);
    const target = findPane(state, op.pane);
    if (!source || !target) return state;
    if (
      source.id === target.id &&
      (op.index === undefined || source.tabs.indexOf(op.tab) === op.index)
    )
      return state;
    return finish(
      state,
      insertTab(withoutTab(state.root, op.tab), target.id, op.tab, op.index),
    );
  }
  if (op.type === "split") {
    const source = paneOfTab(state, op.tab);
    const target = findPane(state, op.pane);
    if (!source || !target) return state;
    // Splitting a pane by its only tab would leave nothing behind.
    if (source.id === target.id && source.tabs.length === 1) return state;
    const created: DockPane = {
      type: "pane",
      id: "pane-" + state.next,
      tabs: [op.tab],
      active: op.tab,
    };
    const root = splitPane(
      withoutTab(state.root, op.tab),
      target.id,
      created,
      "split-" + (state.next + 1),
      op.direction,
      op.before ?? false,
    );
    return finish({ ...state, next: state.next + 2 }, root);
  }
  const resized = resizeSplit(state.root, op.split, op.sizes);
  return resized === state.root ? state : { ...state, root: resized };
}

export interface DockHistory {
  past: readonly DockState[];
  present: DockState;
  future: readonly DockState[];
}

export const dockHistoryLimit = 50;

export function createDockHistory(present: DockState): DockHistory {
  return { past: [], present, future: [] };
}

/** Applies an operation and records the prior state when anything changed. */
export function dockDo(history: DockHistory, op: DockOp): DockHistory {
  const present = applyDock(history.present, op);
  if (present === history.present) return history;
  return {
    past: [...history.past, history.present].slice(-dockHistoryLimit),
    present,
    future: [],
  };
}

export function dockUndo(history: DockHistory): DockHistory {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function dockRedo(history: DockHistory): DockHistory {
  const [next, ...future] = history.future;
  if (!next) return history;
  return { past: [...history.past, history.present], present: next, future };
}
