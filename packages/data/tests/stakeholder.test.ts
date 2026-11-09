import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { StakeholderUpdates } from "../src/stakeholder.ts";
it("drafts cited progress and explicit unknowns from only the selected product", () => {
  const db = new Database(":memory:");
  migrate(db);
  try {
    for (const id of ["atlas", "beacon"]) {
      db.prepare(
        "INSERT INTO products(id,name,created_at) VALUES(?,?,'now')",
      ).run(id, id);
      db.prepare(
        "INSERT INTO work_items(id,product_id,title,type,status) VALUES(?,?,?,'story','draft')",
      ).run(id, id, id + " work");
    }
    const updates = new StakeholderUpdates(db);
    const draft = updates.draft("atlas");
    expect(draft).toContain("atlas work");
    expect(draft).toContain("[work item: atlas]");
    expect(draft).toContain("Unknown");
    expect(draft).not.toContain("beacon");
    expect(updates.draft(null)).toContain("beacon work");
    const portfolio = updates.prepareExport(
      null,
      "Portfolio",
      updates.draft(null),
    );
    updates.claimExport(
      null,
      portfolio.id,
      portfolio.binding,
      portfolio.title,
      portfolio.text,
    );
    const review = updates.prepareExport("atlas", "Status", draft);
    expect(() =>
      updates.claimExport(
        "atlas",
        review.id,
        review.binding,
        "Status",
        draft + " altered",
      ),
    ).toThrow();
    expect(() =>
      updates.claimExport("beacon", review.id, review.binding, "Status", draft),
    ).toThrow();
    updates.claimExport("atlas", review.id, review.binding, "Status", draft);
    expect(() =>
      updates.claimExport("atlas", review.id, review.binding, "Status", draft),
    ).toThrow();
  } finally {
    db.close();
  }
});
