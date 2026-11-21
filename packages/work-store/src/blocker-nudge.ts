import { randomUUID } from "node:crypto";
import type { Database } from "./sqlite.ts";

type Input = { areaId: string; blockerId: string; chatId: string; ref: string };
type Nudge = {
  ref: string;
  chat_id: string;
  receipt_id: string;
  text: string;
  state: string;
};
export async function draftBlockerNudge(
  db: Database,
  input: Input,
  send: (prompt: string) => Promise<string>,
  space?: string,
) {
  const { areaId, blockerId, chatId, ref } = input;
  const now = () => new Date().toISOString();
  const draft = db
    .transaction(() => {
      const blocker = db
        .prepare(
          `SELECT b.title,b.owner,b.sprint_link_json,a.name AS project,c.title AS chat
      FROM work_blockers b JOIN work_areas a ON a.id=b.work_area_id JOIN work_chats c ON c.work_area_id=a.id
      WHERE b.id=? AND a.id=? AND a.status<>'deleted' AND b.resolved_at IS NULL AND c.id=?
      AND c.sprint_connection=json_extract(b.sprint_link_json,'$.sourceId') AND c.sprint_id=json_extract(b.sprint_link_json,'$.sprintId')`,
        )
        .get(blockerId, areaId, chatId) as
        | {
            title: string;
            owner: string | null;
            sprint_link_json: string;
            project: string;
            chat: string;
          }
        | undefined;
      if (!blocker)
        throw Error("The blocker or its sprint conversation changed.");
      const previous = db
        .prepare("SELECT * FROM blocker_nudges WHERE blocker_id=?")
        .get(blockerId) as Nudge | undefined;
      if (previous && previous.state !== "failed") return null;
      const requestId = randomUUID(),
        receiptId = randomUUID();
      const prompt =
        "Request " +
        ref +
        " · Draft a short message to the recorded blocker owner about the affected story. Return only the editable draft text. No send or tracker change is authorized. Source data follows.\n" +
        JSON.stringify({
          areaId,
          chatId,
          blockerId,
          ...blocker,
          link: JSON.parse(blocker.sprint_link_json),
        });
      const insert = db.prepare(
        "INSERT INTO work_messages(id,work_area_id,chat_id,role,text,created_at) VALUES(?,?,?,?,?,?)",
      );
      insert.run(requestId, areaId, chatId, "you", prompt, now());
      insert.run(
        receiptId,
        areaId,
        chatId,
        "card",
        ref + " · Preparing message draft",
        now(),
      );
      db.prepare(
        "INSERT INTO work_requests(ref,message_id,project_area_id,status,updated_at) VALUES(?,?,?,'working',?)",
      ).run(ref, requestId, areaId, now());
      db.prepare(
        "INSERT INTO blocker_nudges(blocker_id,ref,chat_id,receipt_id,text,state) VALUES(?,?,?,?,'','drafting') ON CONFLICT(blocker_id) DO UPDATE SET ref=excluded.ref,chat_id=excluded.chat_id,receipt_id=excluded.receipt_id,text='',state='drafting'",
      ).run(blockerId, ref, chatId, receiptId);
      if (space)
        db.prepare("UPDATE blocker_nudges SET space=? WHERE ref=?").run(
          space,
          ref,
        );
      return { prompt, receiptId };
    })
    .immediate();
  if (!draft) return;
  let body = "";
  try {
    body = (await send(draft.prompt)).trim();
  } catch {}
  const ok = body.length > 0 && body.length <= 16000;
  const status = ok
    ? "Draft ready · delivery unconfirmed"
    : "Draft unavailable · try again";
  db.transaction(() => {
    db.prepare(
      "UPDATE blocker_nudges SET text=?,state=? WHERE ref=? AND state='drafting'",
    ).run(ok ? body : "", ok ? "draft" : "failed", ref);
    db.prepare("UPDATE work_messages SET text=? WHERE id=?").run(
      ref + " · " + status + (ok ? "\n" + body : ""),
      draft.receiptId,
    );
    db.prepare(
      "UPDATE work_requests SET status=?,detail=?,updated_at=? WHERE ref=?",
    ).run(ok ? "delivered" : "needs-decision", status, now(), ref);
  }).immediate();
}

export function recordNudgeAction(
  db: Database,
  areaId: string,
  blockerId: string,
  ref: string,
  body: string,
  action: "copied" | "manual",
) {
  const nudge = db
    .prepare(
      "SELECT n.* FROM blocker_nudges n JOIN work_blockers b ON b.id=n.blocker_id WHERE b.work_area_id=? AND b.id=? AND n.ref=?",
    )
    .get(areaId, blockerId, ref) as Nudge | undefined;
  if (
    !nudge ||
    !["draft", "copied", "manual"].includes(nudge.state) ||
    !body.trim()
  )
    throw Error("The reviewed message draft is unavailable.");
  if (
    nudge.state === "manual" ||
    (nudge.state === action && nudge.text === body)
  )
    return false;
  const detail =
    action === "manual"
      ? "Sent manually · confirmed by you"
      : "Copied · delivery unconfirmed";
  db.prepare("UPDATE blocker_nudges SET text=?,state=? WHERE ref=?").run(
    body,
    action,
    ref,
  );
  db.prepare("UPDATE work_messages SET text=? WHERE id=?").run(
    ref + " · " + detail + "\n" + body,
    nudge.receipt_id,
  );
  return true;
}
