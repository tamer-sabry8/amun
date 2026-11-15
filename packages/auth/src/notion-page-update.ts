// Updates one Notion page that Amun created, only if nobody has changed it
// since Amun last wrote it. The caller must hold an approved plan.
import { z } from "zod";
import { notionPageVersion } from "../../domain/src/notion-update.ts";
import { notionTargetReference, uuidFromReference } from "./notion-result.ts";

export interface NotionPageSnapshot {
  title: string | undefined;
  content: string;
  /** The page's parent as a bare id, or undefined when it cannot be read. */
  parent: string | undefined;
  trashed: boolean;
  version: string;
  url: string;
}

const same = (a: string, b: string) =>
  a.replaceAll("-", "").toLowerCase() === b.replaceAll("-", "").toLowerCase();

/** Reads a `notion-fetch` reply for one page; throws on anything unexpected. */
export function readNotionPage(
  raw: unknown,
  pageId: string,
  titleProperty = "title",
): NotionPageSnapshot {
  const reply = z
    .object({
      isError: z.literal(false).optional(),
      content: z.tuple([
        z.object({ type: z.literal("text"), text: z.string().max(1048576) }),
      ]),
    })
    .parse(raw);
  const record = z
    .object({
      url: z.string(),
      metadata: z.object({ type: z.literal("page") }),
      truncated: z.literal(false).optional(),
      in_trash: z.boolean().optional(),
      archived: z.boolean().optional(),
      last_edited_time: z.string().max(64).optional(),
      text: z.string().max(524288),
    })
    .parse(JSON.parse(reply.content[0].text));
  const url = notionTargetReference(record.url);
  if (!same(uuidFromReference(url), pageId)) throw Error("Notion page changed");
  const start = record.text.indexOf("\n<content>\n");
  const content =
    start === -1
      ? undefined
      : /^\n<content>\n([\s\S]*?)\n<\/content>\n<\/page>(?:\n|$)/.exec(
          record.text.slice(start),
        )?.[1];
  if (content === undefined || /^<\/?(?:page|content)(?:>| )/m.test(content))
    throw Error("Incomplete page");
  const header = record.text.slice(0, start);
  const ancestor = /^<ancestor-path>\n([^\n]*)/m.exec(header)?.[1] ?? "";
  const dataSource =
    /^<parent-data-source url="(?:\{\{)?collection:\/\/([a-f0-9-]+)(?:\}\})?"/i.exec(
      ancestor,
    )?.[1];
  const parentPage = /^<parent-page url="([^"]+)"/.exec(ancestor)?.[1];
  let parent: string | undefined = dataSource;
  if (!parent && parentPage) {
    try {
      parent = uuidFromReference(notionTargetReference(parentPage));
    } catch {
      parent = undefined;
    }
  }
  let title: string | undefined;
  const props = /^<properties>\n([^\n]+)\n<\/properties>$/m.exec(header)?.[1];
  if (props) {
    try {
      const value = (JSON.parse(props) as Record<string, unknown>)[
        titleProperty
      ];
      if (typeof value === "string") title = value;
    } catch {
      title = undefined;
    }
  }
  const editedTime =
    record.last_edited_time ??
    /"?last_edited_time"?\s*[:=]\s*"([^"]+)"/.exec(header)?.[1];
  return {
    title,
    content,
    parent,
    trashed: record.in_trash === true || record.archived === true,
    version: notionPageVersion({ title, content, editedTime }),
    url: "https://www.notion.so/" + url,
  };
}

export interface NotionPageUpdate {
  pageId: string;
  /** The version Amun recorded when it last wrote the page. */
  expectedVersion: string;
  /** The page must sit directly under this approved destination. */
  parentId: string;
  titleProperty: string;
  /** Unchanged when absent. */
  title?: string | undefined;
  text: string;
  /** The page's publication marker, kept at the end of its content. */
  marker: string;
}
export type NotionUpdateOutcome =
  | { state: "updated"; version: string }
  | { state: "changed"; url: string }
  | { state: "elsewhere" }
  | { state: "gone" }
  | { state: "unknown" }
  /** Notion answered with an error and the page was left as it was. */
  | { state: "refused"; detail: string };

/** What a tool call can report: done, unconfirmed, or refused with a reason. */
export type NotionCallResult = boolean | { refused: string };

const footer = (marker: string) => "\n\nAmun publication ID: " + marker;
/** The content the page will hold: the new text, and the marker if it had one. */
export function updatedContent(
  update: Pick<NotionPageUpdate, "text" | "marker">,
  current: string,
) {
  return current.trimEnd().endsWith("Amun publication ID: " + update.marker)
    ? update.text + footer(update.marker)
    : update.text;
}

/**
 * The smallest search-and-replace that turns `before` into `after`, anchored
 * on one unchanged neighbouring line so it can match exactly once. Undefined
 * when no unambiguous edit exists.
 */
export function contentEdit(before: string, after: string) {
  const a = before.split("\n");
  const b = after.split("\n");
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (
    s < a.length - p &&
    s < b.length - p &&
    a[a.length - 1 - s] === b[b.length - 1 - s]
  )
    s++;
  const oldMid = a.slice(p, a.length - s);
  const newMid = b.slice(p, b.length - s);
  if (!oldMid.length && !newMid.length) return undefined;
  const attempts: [string[], string[]][] = oldMid.length
    ? [[oldMid, newMid]]
    : [];
  if (p > 0)
    attempts.push([
      [a[p - 1]!, ...oldMid],
      [a[p - 1]!, ...newMid],
    ]);
  if (s > 0) {
    const next = a[a.length - s]!;
    attempts.push([
      [...oldMid, next],
      [...newMid, next],
    ]);
  }
  for (const [o, n] of attempts) {
    const old_str = o.join("\n");
    if (
      old_str.trim() &&
      before.indexOf(old_str) !== -1 &&
      before.indexOf(old_str) === before.lastIndexOf(old_str)
    )
      return { old_str, new_str: n.join("\n") };
  }
  return undefined;
}

/**
 * Reads the page, stops when it differs from what Amun last wrote, and
 * otherwise changes only what the approved text changes, keeping the marker.
 * `read` and `call` talk to Notion; `beforeSend` runs once, just before
 * anything is changed.
 */
export async function updateNotionPage(
  update: NotionPageUpdate,
  io: {
    read(): Promise<NotionPageSnapshot>;
    call(
      command: "update_content" | "replace_content" | "update_properties",
      body: object,
    ): Promise<NotionCallResult>;
    beforeSend(): void;
  },
): Promise<NotionUpdateOutcome> {
  const before = await io.read();
  if (before.trashed) return { state: "gone" };
  if (!before.parent || !same(before.parent, update.parentId))
    return { state: "elsewhere" };
  if (before.version !== update.expectedVersion)
    return { state: "changed", url: before.url };
  io.beforeSend();
  try {
    const content = updatedContent(update, before.content);
    const hadMarker = before.content
      .trimEnd()
      .endsWith("Amun publication ID: " + update.marker);
    if (content !== before.content) {
      const edit = contentEdit(before.content, content);
      let result: NotionCallResult = false;
      if (edit)
        result = await io.call("update_content", {
          content_updates: [edit],
        });
      // A refused edit left the page as it was, so the whole-page form is safe.
      if (result !== true)
        result = await io.call("replace_content", { new_str: content });
      if (result !== true)
        return typeof result === "object"
          ? { state: "refused", detail: result.refused }
          : { state: "unknown" };
    }
    if (update.title !== undefined && update.title !== before.title)
      if (
        (await io.call("update_properties", {
          properties: { [update.titleProperty]: update.title },
        })) !== true
      )
        return { state: "unknown" };
    const after = await io.read();
    if (hadMarker && !after.content.includes(update.marker))
      return { state: "unknown" };
    return { state: "updated", version: after.version };
  } catch {
    // A change may have landed; the caller looks before anything is repeated.
    return { state: "unknown" };
  }
}
