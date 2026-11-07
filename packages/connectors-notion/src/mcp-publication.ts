import type { NotionPublication, NotionResult } from "./client.ts";
export interface NotionCreateCall {
  name: "notion-create-pages";
  arguments: {
    parent: { page_id: string } | { data_source_id: string };
    pages: { properties: Record<string, string>; content: string }[];
    allow_async: false;
  };
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function object(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
}
/** Service-only transport; its caller must claim an approved durable action first. */
export class NotionMcpPublisher {
  constructor(
    private readonly call: (request: NotionCreateCall) => Promise<unknown>,
  ) {}
  async create(input: NotionPublication): Promise<NotionResult> {
    const type = input.parentType ?? "page_id";
    const property = input.titleProperty ?? "title";
    if (
      (input.markerPropertyId !== undefined &&
        (type !== "data_source_id" ||
          !uuid.test(input.markerPropertyId) ||
          property === "Amun publication ID")) ||
      !uuid.test(input.parentId) ||
      !["page_id", "data_source_id"].includes(type) ||
      !property.trim() ||
      property.length > 256 ||
      /[\0\r\n]/.test(property) ||
      ["__proto__", "prototype", "constructor"].includes(property) ||
      !input.title.trim() ||
      input.title.length > 256 ||
      !input.text.trim() ||
      input.text.length > 262144 ||
      /\0/.test(input.title + input.text)
    )
      throw Error("Invalid reviewed Notion publication");
    const request: NotionCreateCall = {
      name: "notion-create-pages",
      arguments: {
        parent:
          type === "page_id"
            ? { page_id: input.parentId }
            : { data_source_id: input.parentId },
        pages: [
          {
            properties: {
              [property]: input.title,
              ...(input.markerPropertyId
                ? { "Amun publication ID": input.markerPropertyId }
                : {}),
            },
            content: input.text,
          },
        ],
        allow_async: false,
      },
    };
    if (Buffer.byteLength(JSON.stringify(request)) > 450000)
      throw Error("Publication exceeds request limit");
    try {
      const response = object(await this.call(request));
      if (
        !response ||
        response.isError ||
        !Array.isArray(response.content) ||
        response.content.length !== 1
      )
        return { state: "unknown" };
      const item = object(response.content[0]);
      if (
        item?.type !== "text" ||
        typeof item.text !== "string" ||
        item.text.length > 65536
      )
        return { state: "unknown" };
      const result = object(JSON.parse(item.text));
      if (
        !result ||
        result.async_task ||
        (result.warnings !== undefined &&
          (!Array.isArray(result.warnings) || result.warnings.length)) ||
        !Array.isArray(result.pages) ||
        result.pages.length !== 1
      )
        return { state: "unknown" };
      const page = object(result.pages[0]);
      if (
        !page ||
        typeof page.id !== "string" ||
        !uuid.test(page.id) ||
        object(page.properties)?.[property] !== input.title
      )
        return { state: "unknown" };
      return { state: "created", pageId: page.id };
    } catch {
      // A response lost after creation must never trigger a second create.
      return { state: "unknown" };
    }
  }
}
