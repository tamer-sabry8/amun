import { expect, it } from "vitest";
it("preserves divergent fields until a reviewed resolution and distinguishes deletion from lost access", async () => {
  const { syncState } = await import("../src/memory-sync.ts");
  expect(syncState("base", "local", { kind: "value", value: "remote" })).toBe(
    "conflict",
  );
  expect(syncState("base", "base", { kind: "value", value: "remote" })).toBe(
    "incoming",
  );
  expect(syncState("base", "local", { kind: "value", value: "base" })).toBe(
    "outgoing",
  );
  expect(syncState("base", "local", { kind: "deleted" })).toBe("deleted");
  expect(syncState("base", "local", { kind: "unavailable" })).toBe(
    "unavailable",
  );
  expect(syncState("base", "local", { kind: "value", value: "local" })).toBe(
    "synced",
  );
  expect(syncState(null, "local", { kind: "value", value: "remote" })).toBe(
    "conflict",
  );
});
