import { expect, test } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { WorkStore } from "../src/work-store.ts";
import { parseAmunActions } from "../../../apps/renderer/src/rebuild/view-model.ts";

// The owner asked "Change the name of the product to Arabic Voice". Before,
// Firstmate could only raise a plan addressed to Amun, which nothing could
// publish, so the name never changed. This walks the same request through
// what the chat does with Firstmate's reply.
test("a rename asked for in the chat changes the name and raises nothing", () => {
  const db = new Database(":memory:");
  migrate(db);
  const store = new WorkStore(db);
  const send = (action: string, extra: Record<string, unknown>) =>
    store
      .handle({ version: 1, kind: "work", action, ...extra })
      .find((event) => (event as { kind: string }).kind === "work-result") as {
      ok: boolean;
      ref: string | null;
    };
  const areaId = send("create-area", {
    groupId: null,
    type: "product",
    name: "Test Product 1",
  }).ref!;

  const reply = [
    "Done. This is now called Arabic Voice.",
    "```amun",
    JSON.stringify({ do: "rename", name: "Arabic Voice" }),
    "```",
  ].join("\n");
  const parsed = parseAmunActions(reply);
  expect(parsed.text).toBe("Done. This is now called Arabic Voice.");

  // Exactly what the chat sends for a rename action.
  for (const action of parsed.actions)
    if (action.do === "rename")
      expect(
        send("update-area", { areaId, patch: { name: action.name } }).ok,
      ).toBe(true);

  const after = store.snapshot();
  expect(after.areas.find((item) => item.id === areaId)?.name).toBe(
    "Arabic Voice",
  );
  expect(after.plans).toEqual([]);
  expect(after.attention).toEqual([]);
});
