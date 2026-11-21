import type { Database } from "./sqlite.ts";

type Evidence = { rev: number; blocked: boolean };
type Member = { id: number; indicator?: Evidence };

export function observeSprintBlockers(
  db: Database,
  scope: {
    productId: string;
    workAreaId: string;
    sourceId: string;
    sprint: string;
    team: string;
  },
  members: Member[] | null,
  at = new Date().toISOString(),
) {
  const byId = new Map(members?.map((item) => [String(item.id), item]));
  db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT b.id,b.sprint_link_json,b.azure_indicator_json FROM work_blockers b
      JOIN work_areas a ON a.id=b.work_area_id WHERE a.id=? AND a.product_id=? AND a.status<>'deleted'
      AND b.resolved_at IS NULL AND json_extract(b.sprint_link_json,'$.sourceId')=?
      AND json_extract(b.sprint_link_json,'$.sprintId')=?`,
      )
      .all(
        scope.workAreaId,
        scope.productId,
        scope.sourceId,
        "ado:" + scope.sprint,
      ) as {
      id: string;
      sprint_link_json: string;
      azure_indicator_json: string | null;
    }[];
    for (const row of rows) {
      const link = JSON.parse(row.sprint_link_json);
      if (link.teamId && link.teamId !== scope.team) continue;
      const observed = byId.get(link.storyId)?.indicator;
      const prior = row.azure_indicator_json
        ? (JSON.parse(row.azure_indicator_json) as Evidence & {
            checkedAt: string;
          })
        : null;
      if (
        !observed ||
        (prior &&
          (observed.rev < prior.rev ||
            (observed.rev === prior.rev && observed.blocked !== prior.blocked)))
      ) {
        db.prepare(
          "UPDATE work_blockers SET azure_check_pending=1 WHERE id=?",
        ).run(row.id);
        continue;
      }
      const cleared =
        link.trackAzureIndicator === true &&
        prior?.blocked === true &&
        !observed.blocked &&
        observed.rev > prior.rev;
      db.prepare(
        "UPDATE work_blockers SET azure_indicator_json=?,azure_check_pending=0,resolved_at=? WHERE id=?",
      ).run(
        JSON.stringify({ ...observed, checkedAt: at }),
        cleared ? at : null,
        row.id,
      );
      if (cleared) {
        db.prepare(
          `UPDATE work_messages SET text=text || ? WHERE id=(SELECT receipt_id FROM blocker_nudges WHERE blocker_id=?) AND work_area_id=?`,
        ).run(
          "\nAzure cleared the linked story’s Blocked field at revision " +
            observed.rev +
            ".",
          row.id,
          scope.workAreaId,
        );
      }
    }
  }).immediate();
}
