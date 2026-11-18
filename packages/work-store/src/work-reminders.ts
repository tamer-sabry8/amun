import { randomUUID } from "node:crypto";
import type { Database } from "./sqlite.ts";
import {
  parseReminder,
  reminderIntent,
  reminderMatches,
  reminderTime,
  reminderWhen,
} from "../../domain/src/work/reminders.ts";

type Row = Record<string, unknown>;
export const SNOOZE_MS = 10 * 60_000;
// A reminder shown this long after its time counts as missed.
const LATE_MS = 5000;

export type DueReminder = {
  id: string;
  text: string;
  dueAt: string;
  missed: boolean;
};

/** Local reminders: a time, some words and the work area asked in. Never work. */
export class WorkReminders {
  constructor(
    private db: Database,
    private now: () => Date,
    private clean: (text: string) => string,
  ) {}

  private open() {
    return this.db
      .prepare(
        "SELECT id,text,due_at,state FROM work_reminders WHERE state IN ('scheduled','due') ORDER BY due_at,id",
      )
      .all() as Row[];
  }

  /** Handles "remind me …", "what reminders do I have" and "cancel …". */
  request(text: string, workAreaId: string | null) {
    const now = this.now();
    const intent = reminderIntent(text);
    if (intent === "list") {
      const open = this.open();
      if (!open.length)
        return { ok: true, message: "You have no reminders waiting." };
      return {
        ok: true,
        message:
          "Your reminders:\n" +
          open
            .map(
              (row) =>
                `• ${reminderTime(String(row.due_at), now)} — ${row.text}`,
            )
            .join("\n"),
      };
    }
    if (intent === "cancel") {
      const open = this.open().map((row) => ({
        id: String(row.id),
        text: String(row.text),
      }));
      const named = reminderMatches(text, open);
      const picked = named.length ? named : open.length === 1 ? open : [];
      if (!picked.length)
        return {
          ok: true,
          message: open.length
            ? "Which reminder? Tell me a few words from it, or say “cancel all reminders”."
            : "You have no reminders to cancel.",
        };
      if (picked.length > 1 && !/\b(?:all|every|everything)\b/i.test(text))
        return {
          ok: true,
          message:
            "That matches more than one reminder. Tell me a bit more, or say “cancel all reminders”.",
        };
      for (const row of picked) this.close(row.id, "cancelled");
      return {
        ok: true,
        message:
          picked.length === 1
            ? `Cancelled the reminder: ${picked[0]!.text}`
            : `Cancelled ${picked.length} reminders.`,
      };
    }
    const parsed = parseReminder(text, now);
    if (!parsed.ok) return { ok: false, message: parsed.message };
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO work_reminders(id,text,due_at,work_area_id,state,created_at) VALUES (?,?,?,?,'scheduled',?)",
      )
      .run(
        id,
        this.clean(parsed.what),
        parsed.dueAt.toISOString(),
        workAreaId,
        now.toISOString(),
      );
    return {
      ok: true,
      ref: id,
      message: `Okay. I’ll remind you ${reminderWhen(parsed.dueAt, now)}: ${parsed.what}`,
    };
  }

  private close(id: string, state: "done" | "cancelled") {
    return this.db
      .prepare(
        "UPDATE work_reminders SET state=?,resolved_at=? WHERE id=? AND state IN ('scheduled','due')",
      )
      .run(state, this.now().toISOString(), id).changes;
  }

  finish(id: string) {
    this.close(id, "done");
  }
  cancel(id: string) {
    this.close(id, "cancelled");
  }
  snooze(id: string) {
    this.db
      .prepare(
        "UPDATE work_reminders SET state='scheduled',due_at=?,missed_at=NULL WHERE id=? AND state='due'",
      )
      .run(new Date(this.now().getTime() + SNOOZE_MS).toISOString(), id);
  }

  /** Marks reminders whose time has come as due and returns the new ones. */
  deliver(resume: boolean): DueReminder[] {
    const at = this.now();
    const rows = this.db
      .prepare(
        "SELECT id,text,due_at FROM work_reminders WHERE state='scheduled' AND due_at<=? ORDER BY due_at,id",
      )
      .all(at.toISOString()) as Row[];
    if (!rows.length) return [];
    return this.db
      .transaction(() =>
        rows.map((row) => {
          const dueAt = String(row.due_at);
          const missed = resume || at.getTime() - Date.parse(dueAt) > LATE_MS;
          this.db
            .prepare(
              "UPDATE work_reminders SET state='due',missed_at=? WHERE id=?",
            )
            .run(missed ? dueAt : null, row.id);
          return {
            id: String(row.id),
            text: String(row.text),
            dueAt,
            missed,
          };
        }),
      )
      .immediate();
  }

  list() {
    return (
      this.db
        .prepare(
          "SELECT id,text,due_at,work_area_id,state,missed_at FROM work_reminders WHERE state IN ('scheduled','due') ORDER BY due_at,id",
        )
        .all() as Row[]
    ).map((row) => ({
      id: String(row.id),
      text: String(row.text),
      dueAt: String(row.due_at),
      workAreaId: (row.work_area_id as string | null) ?? null,
      state: row.state as "scheduled" | "due",
      missedAt: (row.missed_at as string | null) ?? null,
    }));
  }
}
