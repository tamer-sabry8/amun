import { it, expect } from "vitest";
import { sessionTree } from "../src/native-session-tree.ts";
const node = (id: string, parentId: string | null) => ({
  id,
  parentId,
  type: "message",
  privateContent: "secret-fixture",
});
it("preserves siblings and nesting, marks the current entry and projects metadata only", () => {
  const rows = sessionTree(
    [
      node("root", null),
      node("left", "root"),
      node("right", "root"),
      node("leaf", "left"),
    ],
    "left",
  );
  expect(rows.map((x) => [x.id, x.depth, x.current])).toEqual([
    ["root", 0, false],
    ["left", 1, true],
    ["leaf", 2, false],
    ["right", 1, false],
  ]);
  expect(JSON.stringify(rows)).not.toContain("secret-fixture");
});
it("rejects broken parentage, duplicate entries, unknown current entries and cycles", () => {
  for (const invalid of [
    [node("a", "missing")],
    [node("a", null), node("a", null)],
    [node("a", "b"), node("b", "a")],
  ])
    expect(() => sessionTree(invalid, null)).toThrow();
  expect(() => sessionTree([], "missing")).toThrow();
});
