import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { WorkspaceService } from "../src/workspace-service.ts";

it("summarizes both products and confirms only a currently inferred dependency in portfolio scope", () => {
  const db = new Database(":memory:");
  try {
    migrate(db);
    for (const name of ["Atlas", "Beacon"]) {
      db.prepare(
        "INSERT INTO products(id,name,created_at) VALUES(?,?,'now')",
      ).run(name, name);
      db.prepare(
        "INSERT INTO sources(id,product_id,kind,title,external_id,retrieved_at,hash) VALUES(?,?,'repo','Platform','https://github.com/example/platform','now','test')",
      ).run(name, name);
      db.prepare(
        "INSERT INTO work_items(id,product_id,title,status,type) VALUES(?,?,?,'committed','story')",
      ).run(name, name, name + " story");
    }
    const service = new WorkspaceService(db);
    const confirm = (key: string) =>
      service.handle({
        version: 1,
        kind: "workspace",
        action: "confirm-dependency",
        key,
      });
    const summary = service.snapshot().portfolio;
    expect(summary?.products.map((p) => [p.name, p.progress])).toEqual(
      ["Atlas", "Beacon"].map((n) => [n, [{ status: "committed", count: 1 }]]),
    );
    const dependency = summary!.dependencies[0]!;
    expect(dependency.confirmed).toBe(false);
    expect(confirm("unknown")).toMatchObject({ kind: "workspace-error" });
    expect(confirm(dependency.key)).toMatchObject({
      portfolio: { dependencies: [{ confirmed: true }] },
    });
    expect(
      new WorkspaceService(db).snapshot().portfolio?.dependencies[0]?.confirmed,
    ).toBe(true);
    service.handle({
      version: 1,
      kind: "workspace",
      action: "preferences",
      preferences: { ...service.snapshot().preferences, productId: "Atlas" },
    });
    expect(service.snapshot().portfolio).toBeNull();
    expect(confirm(dependency.key)).toMatchObject({ kind: "workspace-error" });
  } finally {
    db.close();
  }
});
