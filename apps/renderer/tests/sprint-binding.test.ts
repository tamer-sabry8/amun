import { expect, it } from "vitest";
import { writeBoard, writeSource } from "../src/backlog-selection.ts";
import {
  resolveSprintBinding,
  writeSprintDefault,
  type SprintArea,
} from "../src/rebuild/sprint-binding.ts";

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
}
const area = (
  id: string,
  productId: string | null,
  at: string,
): SprintArea => ({
  id,
  productId,
  lastContextAt: at,
  createdAt: "2026-01-01T00:00:00Z",
});
const areas = [
  area("a1", "p1", "2026-11-01T00:00:00Z"),
  area("a2", "p2", "2026-11-10T00:00:00Z"),
  area("a3", "p3", "2026-11-14T00:00:00Z"),
];

it("uses the binding Backlog saved for the chosen work area", () => {
  const store = memory();
  writeSource(store, "p1", "s1");
  writeBoard(store, "p1", "s1", { team: "POCs Team", level: "Backlog items" });
  expect(resolveSprintBinding(store, areas, "a1")).toEqual({
    productId: "p1",
    sourceId: "s1",
    team: "POCs Team",
  });
  expect(resolveSprintBinding(store, areas, "a2")).toBeNull();
});

it("for all work areas, prefers the default team, then the most recent binding", () => {
  const store = memory();
  writeBoard(store, "p1", "s1", { team: "T1", level: "" });
  writeBoard(store, "p2", "s2", { team: "T2", level: "" });
  expect(resolveSprintBinding(store, areas, "")?.productId).toBe("p2");
  writeSprintDefault(store, { productId: "p1", sourceId: "s1", team: "T1" });
  expect(resolveSprintBinding(store, areas, "")?.productId).toBe("p1");
});

it("reports no binding when nothing is saved", () => {
  expect(resolveSprintBinding(memory(), areas, "")).toBeNull();
});
