import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { hashDiff } from "../src/code-change.ts";
import { CodeChanges } from "../../../apps/desktop/src/code-change.ts";

function setup() {
  const db = new Database(":memory:");
  migrate(db);
  for (const id of ["p1", "p2"])
    db.prepare("INSERT INTO products(id,name,created_at) VALUES (?,?,?)").run(
      id,
      id,
      "now",
    );
  const area = db.prepare(
    "INSERT INTO work_areas(id,type,name,product_id,created_at) VALUES (?,?,?,?,?)",
  );
  area.run("with-product", "product", "A", "p1", "now");
  area.run("no-product", "product", "B", null, "now");
  const changes = new CodeChanges({
    db,
    root: "/nowhere",
    workspace: {} as never,
    host: () => ({}) as never,
    tokens: async () => [],
    say: () => {},
    revise: async () => {},
  });
  const raise = (product: string, workAreaId: string) => {
    const diff = "+a\n";
    changes.review.propose(
      product,
      {
        repo: { owner: "o", name: "r", url: "https://github.com/o/r" },
        base: "main",
        branch: "amun/x-111111",
        message: "Fix",
        title: "Fix",
        files: [{ path: "a", status: "added", additions: 1, deletions: 0 }],
        diffHash: hashDiff(diff),
        job: "j",
        workAreaId,
      },
      "b".repeat(40),
      diff,
    );
  };
  return { changes, raise };
}

describe("code change cards by work area", () => {
  it("shows a change recorded under another product in the area that asked", async () => {
    const { changes, raise } = setup();
    raise("p2", "with-product");
    expect(await changes.cards("p1")).toHaveLength(1);
    expect(await changes.cards("p1", "with-product")).toHaveLength(1);
  });

  it("shows a change for a product area that has no product id", async () => {
    const { changes, raise } = setup();
    raise("p2", "no-product");
    expect(await changes.cards("p1")).toHaveLength(0);
    const cards = await changes.cards("p1", "no-product");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.state).toBe("waiting");
  });

  it("keeps changes of unrelated areas out", async () => {
    const { changes, raise } = setup();
    raise("p2", "no-product");
    expect(await changes.cards("p1", "with-product")).toHaveLength(0);
  });

  it("still lists changes filed under the product itself", async () => {
    const { changes, raise } = setup();
    raise("p1", "gone");
    expect(await changes.cards("p1", "no-product")).toHaveLength(1);
  });
});
