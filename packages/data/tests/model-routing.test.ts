import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { ModelRouting } from "../src/model-routing.ts";
it("routes by product, task and difficulty and requires exact approval to extend the allowlist", () => {
  const db = new Database(":memory:");
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
