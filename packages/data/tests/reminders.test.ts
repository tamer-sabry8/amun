import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { WorkspaceService } from "../src/workspace-service.ts";
it("delivers an overdue consequential reminder once after downtime and waits for explicit completion", () => {
  const db = new Database(":memory:");
  try {
    migrate(db);
    db.prepare(
      "INSERT INTO products(id,name,created_at) VALUES('p','Atlas','now')",
    ).run();
    const service = new WorkspaceService(db);
    const send = (action: string, fields: Record<string, unknown>) =>
      service.handle({ version: 1, kind: "workspace", action, ...fields });
    send("preferences", { preferences: { productId: "p" } });
    const due = new Date(Date.now() + 60000).toISOString();
    send("save-task", {
      productId: "p",
      title: "Approve release checklist",
      due,
      category: "work",
      consequential: true,
    });
    expect(service.snapshot().productContext?.tasks?.[0]?.state).toBe(
      "scheduled",
    );
    const restarted = new WorkspaceService(db);
    expect(restarted.reminders.deliver(Date.parse(due) + 30000, true)).toBe(1);
    expect(restarted.reminders.deliver(Date.parse(due) + 35000, true)).toBe(0);
    const snapshot = restarted.snapshot();
    expect(snapshot.notifications.map((n) => n.text)).toEqual([
      "Missed reminder · Approve release checklist",
    ]);
    expect(snapshot.attention[0]).toMatchObject({
      state: "open",
      governed: true,
    });
    expect(snapshot.productContext?.tasks?.[0]?.state).toBe("awaiting review");
    expect(db.prepare("SELECT count(*) FROM outbox").pluck().get()).toBe(0);
  } finally {
    db.close();
  }
});
