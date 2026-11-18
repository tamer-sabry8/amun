import { z } from "zod";
const identitySchema = z.object({
  workspace: z.object({
    id: z.string().regex(/^[a-f0-9-]{32,36}$/i),
    name: z.string().min(1).max(256),
  }),
  user: z.object({
    type: z.enum(["person", "bot"]),
    name: z.string().max(256).nullable().optional(),
  }),
});
export interface NotionIdentity {
  workspaceId: string;
  workspaceName: string;
  userName: string;
  userType: "person" | "bot";
}
export function notionIdentity(input: unknown): NotionIdentity {
  const response = z
    .object({
      isError: z.literal(false).optional(),
      content: z
        .array(
          z.object({ type: z.literal("text"), text: z.string().max(32768) }),
        )
        .min(1)
        .max(8),
    })
    .parse(input);
  const value = identitySchema.parse(JSON.parse(response.content[0]!.text));
  return {
    workspaceId: value.workspace.id,
    workspaceName: value.workspace.name,
    userName: value.user.name ?? "Notion user",
    userType: value.user.type,
  };
}
export function notionTargetReference(input: string): string {
  if (input.length > 2048) throw Error("Invalid Notion destination");
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !["app.notion.com", "notion.so", "www.notion.so"].includes(url.hostname)
  )
    throw Error("Use a Notion page or database link");
  const last = url.pathname.replace(/\/$/, "").split("/").at(-1) ?? "";
  const match =
    /([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.exec(
      last,
    );
  if (!match) throw Error("Notion page identity missing");
  return match[1]!.replaceAll("-", "").toLowerCase();
}

const fetchSchema = z.object({
  metadata: z.object({ type: z.enum(["page", "database"]) }),
  title: z.string().min(1).max(256),
  url: z.string().max(2048),
  text: z.string().max(524288).optional(),
  truncated: z.literal(false).optional(),
});
export interface NotionDestination {
  title: string;
  parentId: string;
  parentType: "page_id" | "data_source_id";
  titleProperty: string;
  markerPropertyAvailable?: boolean;
}
export function uuidFromReference(id: string) {
  const hex = id.replaceAll("-", "").toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(hex)) throw Error("Invalid Notion identity");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** Fail closed on schema drift, ambiguous data sources, or a mismatched fetch. */
export function notionDestination(
  input: unknown,
  expectedId: string,
): NotionDestination {
  const response = z
    .object({
      isError: z.literal(false).optional(),
      content: z
        .array(
          z.object({ type: z.literal("text"), text: z.string().max(1048576) }),
        )
        .length(1),
    })
    .parse(input);
  const fetched = fetchSchema.parse(JSON.parse(response.content[0]!.text));
  const parentId = uuidFromReference(notionTargetReference(fetched.url));
  if (parentId !== uuidFromReference(expectedId))
    throw Error("Notion destination identity changed");
  if (fetched.metadata.type === "page")
    return {
      title: fetched.title,
      parentId,
      parentType: "page_id",
      titleProperty: "title",
    };
  const sources = [
    ...(fetched.text ?? "").matchAll(
      /<data-source\s+url="([^"<>]{1,128})"[^>]*>([\s\S]*?)<\/data-source>/gi,
    ),
  ];
  if (sources.length !== 1)
    throw Error("Select an unambiguous Notion data source");
  const sourceUrl = sources[0]![1]!;
  const sourceReference =
    sourceUrl.startsWith("{{") && sourceUrl.endsWith("}}")
      ? sourceUrl.slice(2, -2)
      : sourceUrl;
  if (!/^collection:\/\/[a-f0-9-]{32,36}$/i.test(sourceReference))
    throw Error("Invalid Notion data source reference");
  const sourceId = uuidFromReference(
    sourceReference.slice("collection://".length),
  );
  const state = /<data-source-state>\s*([\s\S]*?)\s*<\/data-source-state>/.exec(
    sources[0]![2]!,
  );
  if (!state) throw Error("Notion destination schema unavailable");
  const value = z
    .object({
      schema: z.record(
        z.string(),
        z.object({ type: z.string(), name: z.string().max(256).optional() }),
      ),
    })
    .parse(JSON.parse(state[1]!));
  const titles = Object.entries(value.schema).filter(
    ([, field]) => field.type === "title",
  );
  if (
    titles.length !== 1 ||
    !titles[0]![0].trim() ||
    titles[0]![0].length > 256 ||
    /[\0\r\n]/.test(titles[0]![0]) ||
    ["__proto__", "constructor", "prototype"].includes(titles[0]![0])
  )
    throw Error("Notion title schema unavailable");
  return {
    title: fetched.title,
    parentId: sourceId,
    parentType: "data_source_id",
    titleProperty: titles[0]![0],
    ...(["text", "rich_text"].includes(
      value.schema["Amun publication ID"]?.type ?? "",
    )
      ? { markerPropertyAvailable: true }
      : {}),
  };
}
