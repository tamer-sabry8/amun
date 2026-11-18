export interface NotionTarget {
  parentType: "page_id" | "data_source_id";
  parentId: string;
  titleProperty: string;
  label: string;
}
export type NotionGet = (
  path: string,
) => Promise<{ status: number; data: unknown }>;
function canonicalId(input: unknown): string {
  if (
    typeof input !== "string" ||
    !/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(
      input,
    )
  )
    throw Error("Invalid Notion identity");
  const value = input.replaceAll("-", "").toLowerCase();
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20),
  ].join("-");
}
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("Notion target unavailable");
  return input as Record<string, unknown>;
}
export async function resolveNotionTarget(
  value: string,
  get: NotionGet,
): Promise<NotionTarget> {
  if (value.length > 2048) throw Error("Invalid Notion URL");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !["app.notion.com", "notion.so", "www.notion.so"].includes(url.hostname)
  )
    throw Error("Use a Notion page or database URL");
  const last = url.pathname.replace(/\/$/, "").split("/").at(-1) ?? "";
  const id = canonicalId(/([a-f0-9]{32})$/i.exec(last)?.[1] ?? last);
  const database = await get("/v1/databases/" + id);
  if (database.status === 200) {
    const data = record(database.data);
    if (
      data.object !== "database" ||
      canonicalId(data.id) !== id ||
      !Array.isArray(data.data_sources) ||
      data.data_sources.length !== 1
    )
      throw Error("Choose a database with one accessible data source");
    const source = record(data.data_sources[0]),
      sourceId = canonicalId(source.id);
    const response = await get("/v1/data_sources/" + sourceId);
    if (response.status !== 200) throw Error("Notion data source unavailable");
    const schema = record(response.data),
      parent = record(schema.parent);
    if (
      schema.object !== "data_source" ||
      canonicalId(schema.id) !== sourceId ||
      parent.type !== "database_id" ||
      canonicalId(parent.database_id) !== id
    )
      throw Error("Notion destination changed");
    const entries = Object.entries(record(schema.properties));
    if (entries.length > 1000) throw Error("Notion schema exceeds limits");
    const titles = entries.filter(([, v]) => record(v).type === "title");
    if (titles.length !== 1 || !titles[0]![0] || titles[0]![0].length > 256)
      throw Error("Notion title property unavailable");
    return {
      parentType: "data_source_id",
      parentId: sourceId,
      titleProperty: titles[0]![0],
      label:
        typeof source.name === "string"
          ? source.name.slice(0, 256)
          : "Notion database",
    };
  }
  if (database.status !== 404) throw Error("Notion destination access failed");
  const response = await get("/v1/pages/" + id);
  if (response.status !== 200) throw Error("Notion page unavailable");
  const page = record(response.data);
  if (
    page.object !== "page" ||
    canonicalId(page.id) !== id ||
    page.archived === true ||
    page.in_trash === true
  )
    throw Error("Notion page unavailable");
  const title = Object.values(record(page.properties))
    .map(record)
    .find((p) => p.type === "title");
  const label = Array.isArray(title?.title)
    ? title.title
        .map((part) => record(part).plain_text)
        .filter((t) => typeof t === "string")
        .join("")
        .slice(0, 256)
    : "";
  return {
    parentType: "page_id",
    parentId: id,
    titleProperty: "title",
    label: label || "Notion page",
  };
}
