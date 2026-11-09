import { z } from "zod";
import { notionTargetReference, uuidFromReference } from "./notion-result.ts";
import { fieldName, syncValue } from "../../contracts/src/memory-sync.ts";
import type { RemoteField } from "../../domain/src/memory-sync.ts";

export function readNotionField(
  raw: unknown,
  page: string,
  label: string,
): RemoteField & { boundary?: string } {
  fieldName.parse(label);
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
      text: z.string().max(524288),
    })
    .parse(JSON.parse(reply.content[0].text));
  if (uuidFromReference(notionTargetReference(record.url)) !== page)
    throw Error("Notion page changed");
  if (record.in_trash || record.archived) return { kind: "deleted" };
  const content = /\n<content>\n([\s\S]*?)\n<\/content>\n<\/page>(?:\n|$)/.exec(
    record.text,
  )?.[1];
  if (content === undefined || /^<\/?(?:content|page)(?:>| )/m.test(content))
    throw Error("Incomplete page");
  const prefix = label + ": ";
  const parts = content.split(/(\n|<br\s*\/?>)/i);
  const matches = parts.flatMap((line, index) =>
    index % 2 === 0 && line.startsWith(prefix) ? [index] : [],
  );
  if (matches.length > 1) throw Error("Ambiguous field");
  const index = matches[0];
  if (index === undefined) return { kind: "deleted" };
  const value = syncValue.parse(parts[index]!.slice(prefix.length));
  // Bound the replacement at the far end, so concurrent appended text cannot match an old prefix.
  const following = parts.slice(index + 1).join("");
  const boundary = /^(?:(?:\n|<br\s*\/?>))+(?:[^\n<]{1,96})/i.exec(
    following,
  )?.[0];
  return { kind: "value", value, ...(boundary ? { boundary } : {}) };
}
