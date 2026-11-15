// Search by content over the full-text index of migration 38.
import type Database from "better-sqlite3";
import {
  matchExpression,
  snippetMarks,
  snippetParts,
  type SnippetPart,
} from "../../domain/src/work/search.ts";

export type ContentHit = {
  kind: "document" | "record" | "message";
  id: string;
  title: string;
  snippet: SnippetPart[];
  workAreaId: string | null;
};

const sql = `
SELECT f.kind AS kind, f.ref AS id, f.snip AS snip,
  CASE f.kind WHEN 'document' THEN o.title WHEN 'record' THEN r.title ELSE a.name END AS title,
  CASE f.kind
    WHEN 'document' THEN (SELECT l.work_area_id FROM library_output_links l JOIN work_areas x ON x.id=l.work_area_id WHERE l.output_id=o.id AND x.status<>'deleted' ORDER BY x.name LIMIT 1)
    WHEN 'record' THEN (SELECT l.work_area_id FROM work_record_links l JOIN work_areas x ON x.id=l.work_area_id WHERE l.record_id=r.id AND x.status<>'deleted' ORDER BY x.name LIMIT 1)
    ELSE m.work_area_id END AS area
FROM (
  SELECT kind, ref, rank, snippet(content_index, -1, ?, ?, '…', 16) AS snip
  FROM content_index WHERE content_index MATCH ?
) f
LEFT JOIN library_outputs o ON f.kind='document' AND o.id=f.ref
LEFT JOIN work_records r ON f.kind='record' AND r.id=f.ref
LEFT JOIN work_messages m ON f.kind='message' AND m.id=f.ref
LEFT JOIN work_areas a ON a.id=m.work_area_id
WHERE (o.id IS NOT NULL OR r.id IS NOT NULL OR (m.id IS NOT NULL AND a.status<>'deleted'))
  AND (? IS NULL OR coalesce(o.group_id, r.group_id, a.group_id) IS NULL OR coalesce(o.group_id, r.group_id, a.group_id)=?)
ORDER BY f.rank
LIMIT ?`;

/**
 * Ranked matches in the text of documents, records and conversations. With a
 * group, only that group's content (and content with no group) is searched;
 * another group's content is never read into the answer.
 */
export function searchContent(
  db: Database.Database,
  query: string,
  groupId: string | null,
  limit = 12,
): ContentHit[] {
  const run = (expression: string) =>
    db
      .prepare(sql)
      .all(
        snippetMarks.open,
        snippetMarks.close,
        expression,
        groupId,
        groupId,
        limit,
      ) as {
      kind: ContentHit["kind"];
      id: string;
      snip: string;
      title: string | null;
      area: string | null;
    }[];
  const all = matchExpression(query, "all");
  if (!all) return [];
  let rows = run(all);
  if (!rows.length) {
    const any = matchExpression(query, "any");
    if (any && any !== all) rows = run(any);
  }
  return rows.map((row) => ({
    kind: row.kind,
    id: row.id,
    title: row.title ?? "",
    snippet: snippetParts(row.snip),
    workAreaId: row.area,
  }));
}
