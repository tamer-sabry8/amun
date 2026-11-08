import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { WorkspaceService } from "../src/workspace-service.ts";

it("switches sources, allowed models and memory together and clears context in the portfolio", () => {
  const db = new Database(":memory:");
  try {
    migrate(db);
    for (const id of ["alpha", "beta"]) {
      db.prepare(
        "INSERT INTO products(id,name,allowed_models_json,created_at) VALUES (?,?,?,?)",
      ).run(id, id, JSON.stringify([id + "-model"]), "now");
      db.prepare(
        "INSERT INTO sources(id,product_id,kind,title,hash,retrieved_at) VALUES (?,?, 'note',?,?, 'now')",
      ).run(id + "-source", id, id + " brief", id);
      db.prepare(
        "INSERT INTO memory_entities(id,product_id,type,data_json,source_id,updated_at) VALUES (?,?,'fact',?,?,'now')",
      ).run(
        id + "-memory",
        id,
        JSON.stringify({ text: id + " fact" }),
        id + "-source",
      );
    }
    const service = new WorkspaceService(db);
    for (const id of ["alpha", "beta", "alpha", null]) {
      const result = service.handle({
        version: 1,
        kind: "workspace",
        action: "preferences",
        preferences: { ...service.snapshot().preferences, productId: id },
      });
      expect(result).toMatchObject({
        productContext: id
          ? {
              productId: id,
              allowedModels: [id + "-model"],
              sources: [{ id: id + "-source", title: id + " brief" }],
              memory: [
                {
                  id: id + "-memory",
                  sourceId: id + "-source",
                  data: { text: id + " fact" },
                },
              ],
            }
          : null,
      });
    }
  } finally {
    db.close();
  }
});

it("creates products and rejects stale mappings after switching products", () => {
  const db = new Database(":memory:");
  try {
    migrate(db);
    const service = new WorkspaceService(db);
    const send = (action: string, fields: Record<string, unknown>) =>
      service.handle({ version: 1, kind: "workspace", action, ...fields });
    const create = (name: string) => {
      expect(
        send("create-product", { name, allowedModels: [name + "-model"] }),
      ).toMatchObject({ kind: "workspace-snapshot" });
      return service.snapshot().preferences.productId!;
    };
    const a = create("A");
    const map = (productId: string) =>
      send("map-source", {
        productId,
        title: "Brief",
        reference: "docs/brief.md",
        sourceKind: "document",
      });
    expect(map(a)).toMatchObject({
      productContext: {
        sources: [{ title: "Brief", reference: "docs/brief.md" }],
      },
    });
    const sourceId = service.snapshot().productContext!.sources[0]!.id;
    const pin = (productId: string) =>
      send("pin-decision", {
        productId,
        sourceId,
        text: "Use the reviewed brief",
      });
    expect(pin(a)).toMatchObject({
      productContext: {
        memory: [
          {
            type: "pinned decision",
            sourceId,
            data: { text: "Use the reviewed brief" },
          },
        ],
      },
    });
    const models = (productId: string) =>
      send("product-models", {
        productId,
        allowedModels: ["local/one", "local/one"],
      });
    expect(models(a)).toMatchObject({
      productContext: { allowedModels: ["local/one"] },
    });
    const b = create("B");
    expect(models(a)).toMatchObject({ kind: "workspace-error" });
    expect(pin(b)).toMatchObject({ kind: "workspace-error" });
    expect(map(a)).toMatchObject({ kind: "workspace-error" });
    expect(service.snapshot()).toMatchObject({
      productContext: {
        productId: b,
        sources: [],
        memory: [],
        allowedModels: ["B-model"],
      },
    });
  } finally {
    db.close();
  }
});

it("binds request reads, decisions and search to the selected product at the service boundary", () => {
  const db = new Database(":memory:");
  try {
    migrate(db);
    for (const id of ["a", "b"]) {
      db.prepare("INSERT INTO products(id,name,created_at) VALUES (?,?,?)").run(
        id,
        id,
        "now",
      );
      db.prepare(
        "INSERT INTO attention_items(id,product_id,type,origin_kind,origin_label,ask,detail,blocking_refs,primary_action_json,governed,state,created_at) VALUES(?,?,'answer','firstmate','Firstmate',?,'','[]',?,0,'open',?)",
      ).run(
        "q" + id,
        id,
        id + " private question",
        JSON.stringify({
          label: "Answer",
          mode: "inline",
          intent: "answer",
          targetRef: "q" + id,
        }),
        new Date().toISOString(),
      );
    }
    const service = new WorkspaceService(db);
    const send = (action: string, fields: Record<string, unknown>) =>
      service.handle({ version: 1, kind: "workspace", action, ...fields });
    send("preferences", {
      preferences: { ...service.snapshot().preferences, productId: "a" },
    });
    expect(service.snapshot().attention.map((q) => q.id)).toEqual(["qa"]);
    expect(
      send("resolve", { id: "qb", source: "review", answer: "foreign answer" }),
    ).toMatchObject({ kind: "workspace-error" });
    expect(send("search", { productId: null, query: "private" })).toMatchObject(
      { results: [{ id: "qa" }] },
    );
  } finally {
    db.close();
  }
});
