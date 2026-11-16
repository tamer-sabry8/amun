import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptanceDb } from "../../../tests/support/ado-acceptance-drafts.ts";
import { productScope } from "../src/product-scope.ts";
import { readPullWorkspace } from "../src/pr-workspace.ts";
it("accepts any existing product, not only the legacy selected one", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-scope-"));
  const db = acceptanceDb(root);
  db.prepare(
    "INSERT INTO products(id,name,created_at) VALUES ('QA','QA','2026-11-15')",
  ).run();
  let closed = false;
  const known = productScope(db, () => closed);
  expect(known("QA")).toBe("QA");
  expect(known("missing")).toBeNull();
  const list = {
    version: 1,
    kind: "pr-workspace",
    id: crypto.randomUUID(),
    action: "list",
    product: "QA",
  };
  const reply = await readPullWorkspace(
    list,
    db,
    [],
    () => known("QA"),
    async () => "",
  );
  expect(reply.product).toBe("QA");
  expect(reply.message).toBe("0 open pull requests.");
  closed = true;
  expect(known("QA")).toBeNull();
  db.close();
  await rm(root, { recursive: true, force: true });
});
