export interface NotionPublication {
  parentId: string;
  parentType?: "page_id" | "data_source_id";
  titleProperty?: string;
  title: string;
  text: string;
}
export type NotionResult =
  { state: "created"; pageId: string } | { state: "unknown" };
export type NotionSend = (
  body: unknown,
) => Promise<{ status: number; data: unknown }>;
const idPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** Only accepts already-reviewed, redacted text; approval belongs to the durable outbox. */
export class NotionPublisher {
  constructor(private readonly send: NotionSend) {}
  async create(input: NotionPublication): Promise<NotionResult> {
    const parentType = input.parentType ?? "page_id";
    const titleProperty = input.titleProperty ?? "title";
    if (
      !["page_id", "data_source_id"].includes(parentType) ||
      !titleProperty.trim() ||
      titleProperty.length > 256 ||
      /[\0\r\n]/.test(titleProperty) ||
      !idPattern.test(input.parentId) ||
      !input.title.trim() ||
      input.title.length > 256 ||
      !input.text.trim() ||
      input.text.length > 196000 ||
      /\0/.test(input.title + input.text)
    )
      throw Error("Invalid Notion publication");
    // Literal rich text avoids interpreting conversation Markdown as embeds or executable formatting.
    const chunks: string[] = [];
    let chunk = "";
    for (const char of input.text) {
      if (chunk.length + char.length > 2000) {
        chunks.push(chunk);
        chunk = "";
      }
      chunk += char;
    }
    if (chunk) chunks.push(chunk);
    const body = {
      parent: { type: parentType, [parentType]: input.parentId },
      properties: {
        [titleProperty]: {
          type: "title",
          title: [{ type: "text", text: { content: input.title } }],
        },
      },
      children: chunks.map((content) => ({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content } }] },
      })),
    };
    if (Buffer.byteLength(JSON.stringify(body), "utf8") > 450000)
      throw Error("Notion publication exceeds request limits");
    try {
      const response = await this.send(body);
      const page = response.data as {
        object?: unknown;
        id?: unknown;
        parent?: {
          type?: unknown;
          page_id?: unknown;
          data_source_id?: unknown;
        };
      } | null;
      if (
        response.status !== 200 ||
        page?.object !== "page" ||
        typeof page.id !== "string" ||
        !idPattern.test(page.id) ||
        page.parent?.type !== parentType ||
        typeof page.parent[parentType] !== "string" ||
        (page.parent[parentType] as string).toLowerCase() !==
          input.parentId.toLowerCase()
      )
        return { state: "unknown" };
      return { state: "created", pageId: page.id };
    } catch {
      return { state: "unknown" };
    }
  }
}
