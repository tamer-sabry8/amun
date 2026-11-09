import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { AttentionStore } from "./attention-store.ts";
type Task = {
  id: string;
  product_id: string;
  title: string;
  category: "personal" | "work";
  due: string;
  state: string;
  consequential: number;
};
export class Reminders {
  constructor(private db: Database.Database) {}
  create(
    product: string,
    title: string,
    category: string,
    due: string,
    consequential: boolean,
  ) {
    this.db
      .prepare(
        "INSERT INTO personal_tasks(id,product_id,title,category,due_at,consequential,state) VALUES(?,?,?,?,?,?,'scheduled')",
      )
      .run(
        randomUUID(),
        product,
        title,
        category,
        new Date(due).toISOString(),
        Number(consequential),
      );
  }
  list(product: string) {
    return (
      this.db
        .prepare(
          "SELECT id,title,category,due_at AS due,state,consequential FROM personal_tasks WHERE product_id=? ORDER BY due_at,id",
        )
        .all(product) as Task[]
    ).map((t) => ({ ...t, consequential: !!t.consequential }));
  }
  deliver(at: number, resume: boolean) {
    const now = new Date(at).toISOString();
    const due = this.db.prepare(
      "SELECT id,product_id,title,due_at AS due,consequential FROM personal_tasks WHERE product_id IS NOT NULL AND state='scheduled' AND due_at<=? ORDER BY due_at,id",
    );
    if (!due.get(now)) return 0;
    return this.db
      .transaction(() => {
        const rows = due.all(now) as Task[];
        for (const t of rows) {
          const missed = resume || at - Date.parse(t.due) > 5000;
          const text =
            (missed ? "Missed reminder" : "Reminder due") + " · " + t.title;
          this.db
            .prepare(
              "INSERT INTO notifications(id,product_id,kind,text,ref,created_at) VALUES(?,?,'reminder_due',?,?,?)",
            )
            .run("task-" + t.id, t.product_id, text, t.id, now);
          if (t.consequential)
            new AttentionStore(this.db).create({
              id: "task-" + t.id,
              productId: t.product_id,
              type: "approve",
              origin: { kind: "amun", label: "Reminders", firstmateRef: null },
              ask: t.title,
              detail: "Review this task before marking it complete.",
              blocking: [],
              primaryAction: {
                label: "Review task",
                mode: "navigate",
                intent: "open_request",
                targetRef: t.id,
              },
              governed: true,
              state: "open",
              snoozedUntil: null,
              createdAt: now,
            });
          this.db
            .prepare("UPDATE personal_tasks SET state=? WHERE id=?")
            .run(t.consequential ? "awaiting review" : "due", t.id);
        }
        return rows.length;
      })
      .immediate();
  }
  complete(
    product: string,
    id: string,
    title: string,
    due: string,
    confirm: boolean,
  ) {
    this.db
      .transaction(() => {
        if (
          !this.db
            .prepare(
              "UPDATE personal_tasks SET state='completed' WHERE id=? AND product_id=? AND title=? AND due_at=? AND state<>'completed' AND (consequential=0 OR ?=1)",
            )
            .run(id, product, title, due, Number(confirm)).changes
        )
          throw Error("Task changed or approval required");
        this.db
          .prepare(
            "UPDATE attention_items SET state='resolved',resolved_at=?,resolved_by='pm' WHERE id=? AND product_id=?",
          )
          .run(new Date().toISOString(), "task-" + id, product);
      })
      .immediate();
  }
}
