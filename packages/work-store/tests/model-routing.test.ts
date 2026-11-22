import { it, expect } from "vitest";
import { openDatabase } from "../src/sqlite.ts";
import { migrate } from "../src/database.ts";
import { modelAllowed, ModelRouting } from "../src/model-routing.ts";
it("routes by product, task and difficulty and requires exact approval to extend the allowlist", () => {
  const db = openDatabase(":memory:");
  migrate(db);
  for (const p of ["a", "b"])
    db.prepare(
      "INSERT INTO products(id,name,created_at,allowed_models_json) VALUES(?,?,'now',?)",
    ).run(p, p, '["local/base"]');
  const r = new ModelRouting(db),
    route = {
      productId: "a",
      task: "conversation" as const,
      difficulty: "complex" as const,
      model: "openrouter/example",
    };
  const proposal = r.save(route)!;
  expect(r.list("a")).toEqual([]);
  expect(() => r.approve("b", proposal.id, proposal.binding)).toThrow();
  expect(() => r.approve("a", proposal.id, "wrong")).toThrow();
  r.approve("a", proposal.id, proposal.binding);
  expect(r.list("a")).toEqual([
    { task: "conversation", difficulty: "complex", model: route.model },
  ]);
  expect(r.list("b")).toEqual([]);
  expect(r.save({ ...route, model: "local/base" })).toBeNull();
  expect(r.list("a")[0]?.model).toBe("local/base");
  db.close();
});

it("lets a product with no allowed models use Firstmate's model, and keeps a set list strict", () => {
  const db = openDatabase(":memory:");
  migrate(db);
  // A product made from a chat starts with an empty list (work-store.ts).
  db.prepare(
    "INSERT INTO products(id,name,created_at,allowed_models_json) VALUES('chat','Sales Prospects','now','[]')",
  ).run();
  db.prepare(
    "INSERT INTO products(id,name,created_at,allowed_models_json) VALUES('set','Gitex','now','[\"local/base\"]')",
  ).run();
  const r = new ModelRouting(db);
  expect(modelAllowed([], "github-copilot/claude-sonnet-5.5")).toBe(true);
  expect(
    r.resolve(
      "chat",
      "stories",
      "standard",
      "github-copilot/claude-sonnet-5.5",
    ),
  ).toBe("github-copilot/claude-sonnet-5.5");
  expect(r.resolve("set", "stories", "standard", "local/base")).toBe(
    "local/base",
  );
  expect(() =>
    r.resolve("set", "stories", "standard", "openrouter/other"),
  ).toThrow("Choose a model allowed for this product.");
  db.close();
});
