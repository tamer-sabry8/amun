import { z } from "zod";
import { notionTargetReference } from "./notion-result.ts";
export const markerProperty = "Amun publication ID";
export type PublicationLookup = {
  marker: string;
  parentId: string;
  parentType: "page_id" | "data_source_id";
  property?: boolean;
};
type ReadTool = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;
function body(raw: unknown) {
  const r = z
    .object({
      isError: z.literal(false).optional(),
      content: z.tuple([
        z.object({ type: z.literal("text"), text: z.string().max(1048576) }),
      ]),
    })
    .parse(raw);
  return JSON.parse(r.content[0].text) as unknown;
}
const uuid = z.uuid();
function same(a: string, b: string) {
  return (
    a.replaceAll("-", "").toLowerCase() === b.replaceAll("-", "").toLowerCase()
  );
}
export async function propertyRows(
  parentId: string,
  marker: string,
  call: ReadTool,
) {
  uuid.parse(parentId);
  uuid.parse(marker);
  const source = "collection://" + parentId;
  const raw = body(
    await call("notion-query-data-sources", {
      data: {
        mode: "sql",
        data_source_urls: [source],
        query:
          'SELECT url FROM "' +
          source +
          '" WHERE "Amun publication ID" = ? LIMIT 9',
        params: [marker],
      },
    }),
  );
  return z
    .object({
      has_more: z.literal(false).optional(),
      next_cursor: z.null().optional(),
      results: z.array(z.object({ url: z.string().max(2048) })).max(9),
    })
    .parse(raw)
    .results.map((r) => notionTargetReference(r.url));
}
export async function findNotionPublication(
  intent: PublicationLookup,
  call: ReadTool,
  url?: string,
) {
  uuid.parse(intent.parentId);
  uuid.parse(intent.marker);
  let ids: string[];
  if (url) ids = [notionTargetReference(url)];
  else if (intent.property)
    ids = await propertyRows(intent.parentId, intent.marker, call);
  else {
    const args =
      intent.parentType === "data_source_id"
        ? { data_source_url: "collection://" + intent.parentId }
        : { page_url: intent.parentId };
    const result = z
      .object({
        results: z.array(z.object({ id: uuid })).max(9),
        has_more: z.literal(false).optional(),
        next_cursor: z.null().optional(),
      })
      .parse(
        body(
          await call("notion-search", {
            query: intent.marker,
            query_type: "internal",
            page_size: 9,
            ...args,
          }),
        ),
      );
    ids = result.results.map((r) => r.id);
  }
  if (ids.length >= 9) return;
  const found = new Set<string>();
  for (const id of new Set(ids)) {
    const p = z
      .object({
        id: uuid,
        url: z.string(),
        metadata: z.object({ type: z.literal("page") }),
        truncated: z.literal(false).optional(),
        text: z.string().max(524288),
      })
      .parse(body(await call("notion-fetch", { id })));
    if (!same(id, p.id) || !same(notionTargetReference(p.url), p.id)) continue;
    const contentStart = p.text.indexOf("\n<content>\n");
    if (contentStart === -1) continue;
    const header = p.text.slice(0, contentStart);
    const content =
      /^\n<content>\n([\s\S]*?)\n<\/content>\n<\/page>(?:\n|$)/.exec(
        p.text.slice(contentStart),
      )?.[1];
    if (content === undefined || /^<\/?(?:page|content)(?:>| )/m.test(content))
      continue;
    const ancestor = /^<ancestor-path>\n([^\n]*)/m.exec(header)?.[1] ?? "";
    const parent =
      intent.parentType === "data_source_id"
        ? /^<parent-data-source url="(?:\{\{)?collection:\/\/([a-f0-9-]+)(?:\}\})?"/i.exec(
            ancestor,
          )?.[1]
        : /^<parent-page url="([^"]+)"/.exec(ancestor)?.[1];
    if (
      !parent ||
      !same(
        intent.parentType === "page_id"
          ? notionTargetReference(parent)
          : parent,
        intent.parentId,
      )
    )
      continue;
    if (intent.property) {
      const props = /^<properties>\n([^\n]+)\n<\/properties>$/m.exec(header);
      if (!props || JSON.parse(props[1]!)[markerProperty] !== intent.marker)
        continue;
    } else {
      const lines = content.trimEnd().split("\n"),
        footer = markerProperty + ": " + intent.marker;
      if (
        lines.at(-1) !== footer ||
        lines.filter((line) => line === footer).length !== 1
      )
        continue;
    }
    found.add(p.id);
  }
  return found.size === 1 ? [...found][0] : undefined;
}
