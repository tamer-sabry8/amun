import type { SprintMoveRequest } from "../../contracts/src/backlog.ts";
import type { Database } from "./sqlite.ts";
import type { BoardDiscovery } from "./ado-board-discovery.ts";
import type { AdoStep } from "./ado-batch.ts";
import { AdoRejected, type AdoWriteClient } from "./ado-governed-writes.ts";
import { requiredInputs, storyTextFields } from "./ado-publication-fields.ts";

interface NewReceipt {
  local_id: string;
  state: string;
  remote_id: number | null;
  remote_rev: number | null;
  step_json: string | null;
  detail: string;
}
export function newStoryReceipts(db: Database, ref: string) {
  return db
    .prepare("SELECT * FROM sprint_new_stories WHERE ref=? ORDER BY rowid")
    .all(ref) as NewReceipt[];
}
export function claimNewStories(db: Database, request: SprintMoveRequest) {
  for (const s of request.creates ?? []) {
    const prior = db
      .prepare(
        "SELECT 1 FROM sprint_new_stories WHERE local_id=? AND (state IN ('pending','unknown','confirmed') OR remote_id IS NOT NULL)",
      )
      .get(s.localId);
    db.prepare(
      "INSERT INTO sprint_new_stories(ref,local_id,state,detail) VALUES(?,?,?,?)",
    ).run(
      request.ref,
      s.localId,
      prior ? "held" : "pending",
      prior ? "This local story already has a submission." : "Pending",
    );
  }
}
export async function createPlannedStories(
  db: Database,
  request: SprintMoveRequest,
  reader: Pick<
    BoardDiscovery,
    "planningCreationTarget" | "processSchema" | "backlogIteration"
  >,
  client: Pick<AdoWriteClient, "write">,
  backlog: { title: string }[],
  mapped: () => boolean,
  inBacklog: (id: number, rev: number) => Promise<boolean>,
) {
  if (!request.creates?.length) return;
  const { ref, creationTarget: reviewed } = request;
  const set = (id: string, state: string, detail: string) =>
    db
      .prepare(
        "UPDATE sprint_new_stories SET state=?,detail=? WHERE ref=? AND local_id=?",
      )
      .run(state, detail, ref, id);
  const target = await reader.planningCreationTarget(
    request.team,
    request.level,
    await reader.backlogIteration(request.team),
  );
  if (
    !target ||
    !reviewed ||
    target.area !== reviewed.area ||
    target.type !== reviewed.type ||
    target.backlogIteration !== reviewed.backlogIteration
  )
    throw Error("Creation destination changed.");
  const type = (await reader.processSchema(true)).types.find(
    (t) => t.name === target.type,
  );
  if (!type) throw Error("The reviewed work item type is unavailable.");
  const pending = new Set(
    newStoryReceipts(db, ref)
      .filter((s) => s.state === "pending")
      .map((s) => s.local_id),
  );
  const normalize = (s: string) =>
    s
      .trim()
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const titles = backlog.map((s) => normalize(s.title));
  for (const story of request.creates) {
    if (!pending.has(story.localId)) continue;
    if (!mapped()) {
      set(story.localId, "held", "The project connection changed.");
      continue;
    }
    const title = normalize(story.title);
    if (
      !story.separate &&
      titles.some(
        (t) =>
          t === title ||
          (t.length > 5 &&
            title.length > 5 &&
            (t.includes(title) || title.includes(t))),
      )
    ) {
      set(
        story.localId,
        "held",
        "Possible duplicate in the team backlog. Review before creating separately.",
      );
      continue;
    }
    const fields = {
      "System.Title": story.title,
      "System.AreaPath": target.area,
      "System.IterationPath": target.backlogIteration,
      ...storyTextFields(type.fields, "", story.criteria),
    };
    const missing = requiredInputs(type, fields);
    if (missing.length) {
      set(story.localId, "held", "Required fields: " + missing.join(", "));
      continue;
    }
    const step: AdoStep = {
      itemId: story.localId,
      type: type.name,
      parentId: null,
      remoteId: null,
      revision: 0,
      fields,
      marker: "Test-" + story.localId,
      creationLabels: story.labels,
    };
    const claim = db
      .prepare(
        "UPDATE sprint_new_stories SET step_json=?,state='unknown',detail='Awaiting independent verification' WHERE ref=? AND local_id=? AND state='pending'",
      )
      .run(JSON.stringify(step), ref, story.localId);
    if (!claim.changes) continue;
    try {
      const result = await client.write(step, null);
      db.prepare(
        "UPDATE sprint_new_stories SET remote_id=?,remote_rev=?,state='held',detail=? WHERE ref=? AND local_id=?",
      ).run(
        result.id,
        result.rev,
        "Created #" + result.id + " · team backlog verification pending",
        ref,
        story.localId,
      );
      titles.push(title);
      if (!mapped() || !(await inBacklog(result.id, result.rev))) continue;
      if (!story.schedule) {
        set(
          story.localId,
          "confirmed",
          "Verified #" + result.id + " in the selected team backlog",
        );
        continue;
      }
      const assignment: AdoStep = {
        itemId: story.localId,
        type: type.name,
        revision: result.rev,
        remoteId: result.id,
        parentId: null,
        marker: step.marker,
        fields: { "System.IterationPath": request.iteration },
      };
      db.prepare(
        "UPDATE sprint_new_stories SET step_json=?,state='unknown',detail=? WHERE ref=? AND local_id=?",
      ).run(
        JSON.stringify(assignment),
        "Created #" + result.id + " · sprint assignment awaiting verification",
        ref,
        story.localId,
      );
      try {
        if (!mapped()) {
          set(
            story.localId,
            "held",
            "Created #" + result.id + " · connection changed before assignment",
          );
          continue;
        }
        const assigned = await client.write(assignment, null);
        db.prepare(
          "UPDATE sprint_new_stories SET remote_rev=?,state='confirmed',detail=? WHERE ref=? AND local_id=?",
        ).run(
          assigned.rev,
          "Verified #" + result.id + " in " + request.iteration,
          ref,
          story.localId,
        );
      } catch (error) {
        if (
          (error instanceof AdoRejected &&
            error.method === "PATCH" &&
            [400, 401, 403, 422].includes(error.status)) ||
          (error instanceof Error && error.message === "revision_conflict")
        )
          set(
            story.localId,
            "held",
            "Created #" + result.id + " · sprint assignment needs review",
          );
      }
    } catch (error) {
      if (
        error instanceof AdoRejected &&
        error.method === "POST" &&
        [400, 401, 403, 422].includes(error.status)
      )
        set(
          story.localId,
          "held",
          "Azure rejected creation. Review the draft.",
        );
    }
  }
}
