import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { WorkspaceService } from "../src/workspace-service.ts";
it("ingests a selected document once per product, with content, hash and retrieval time", async () => {
  const db = new Database(":memory:");
  try {
    migrate(db);
    const s = new WorkspaceService(db);
    s.handle({
      version: 1,
      kind: "workspace",
      action: "create-product",
      name: "Amun",
      allowedModels: [],
    });
    const productId = s.snapshot().preferences.productId!;
    const cmd = {
      version: 1,
      kind: "document-import",
      productId,
      name: "Objective.md",
      bytes: new TextEncoder().encode("# Objective\nReview source evidence."),
    };
    for (let i = 0; i < 2; i++)
      expect(await s.importDocument(cmd)).toMatchObject({
        productContext: { sources: [{ title: "Objective.md", kind: "md" }] },
      });
    expect(
      db
        .prepare(
          "SELECT d.body,s.hash,s.retrieved_at FROM source_documents d JOIN sources s ON s.id=d.source_id",
        )
        .all(),
    ).toEqual([
      {
        body: "# Objective\nReview source evidence.",
        hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        retrieved_at: expect.stringMatching(/^20/),
      },
    ]);
    for (const [name, bytes] of [
      ["bad.exe", cmd.bytes],
      ["empty.txt", new Uint8Array()],
      ["broken.txt", new Uint8Array([255])],
      ["fake.pdf", cmd.bytes],
    ] as const) {
      expect(await s.importDocument({ ...cmd, name, bytes })).toMatchObject({
        kind: "workspace-error",
      });
    }
    expect(
      await s.importDocument({ ...cmd, productId: "foreign" }),
    ).toMatchObject({ kind: "workspace-error" });
    expect(s.snapshot().productContext!.sources).toHaveLength(1);
  } finally {
    db.close();
  }
});
