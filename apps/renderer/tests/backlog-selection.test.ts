import { expect, it } from "vitest";
import {
  readBoard,
  readSource,
  writeBoard,
  writeSource,
  type SelectionStore,
} from "../src/backlog-selection.ts";

function memory() {
  const data = new Map<string, string>();
  const store: SelectionStore = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
  return { data, store };
}

it("restores the project and its team and level after a relaunch", () => {
  const { store } = memory();
  writeSource(store, "p1", "s1");
  writeBoard(store, "p1", "s1", { team: "t1", level: "Backlog items" });
  expect(readSource(store, "p1", ["s0", "s1"])).toBe("s1");
  expect(readBoard(store, "p1", "s1")).toEqual({
    team: "t1",
    level: "Backlog items",
  });
});

it("keeps each product and each project separate", () => {
  const { store } = memory();
  writeSource(store, "p1", "s1");
  writeBoard(store, "p1", "s1", { team: "t1", level: "Epics" });
  expect(readSource(store, "p2", ["s1"])).toBe("");
  expect(readBoard(store, "p2", "s1")).toBeUndefined();
  expect(readBoard(store, "p1", "s2")).toBeUndefined();
});

it("does not restore a project that is no longer mapped", () => {
  const { store } = memory();
  writeSource(store, "p1", "gone");
  expect(readSource(store, "p1", ["s1"])).toBe("");
  expect(readSource(store, "p1", [])).toBe("");
});

it("forgets a cleared choice and ignores damaged or unusable records", () => {
  const { store, data } = memory();
  writeSource(store, "p1", "s1");
  writeSource(store, "p1", "");
  expect(readSource(store, "p1", ["s1"])).toBe("");
  writeBoard(store, "p1", "s1", { team: "t1", level: "" });
  writeBoard(store, "p1", "s1", undefined);
  expect(data.size).toBe(0);
  for (const bad of ["{", "null", '{"team":3}', '{"level":"x"}']) {
    data.set("amun.backlog.board:p1:s1", bad);
    expect(readBoard(store, "p1", "s1")).toBeUndefined();
  }
});

it("keeps working when storage is blocked", () => {
  const blocked: SelectionStore = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  expect(() => writeSource(blocked, "p1", "s1")).not.toThrow();
  expect(readSource(blocked, "p1", ["s1"])).toBe("");
  expect(readBoard(blocked, "p1", "s1")).toBeUndefined();
});
