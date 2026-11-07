import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import type { NotionPublication } from "../../connectors-notion/src/client.ts";
interface Receipt {
  pageId: string;
  parentId: string;
  contentHash: string;
  parentType?: "page_id" | "data_source_id";
  titleProperty?: string;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function publication(
  input: unknown,
): NotionPublication & { contentHash: string } {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) =>
        ![
          "contentHash",
          "parentId",
          "parentType",
          "titleProperty",
          "text",
          "title",
        ].includes(key),
    )
  )
    throw Error("Invalid approved publication");
  const value = input as NotionPublication & { contentHash: string };
  if (
    (value.parentType !== undefined &&
      !["page_id", "data_source_id"].includes(value.parentType)) ||
    (value.titleProperty !== undefined &&
      (typeof value.titleProperty !== "string" ||
        !value.titleProperty.trim() ||
        value.titleProperty.length > 256 ||
        /[\0\r\n]/.test(value.titleProperty))) ||
    typeof value.parentId !== "string" ||
    !uuid.test(value.parentId) ||
    typeof value.title !== "string" ||
    typeof value.text !== "string" ||
    typeof value.contentHash !== "string" ||
    value.contentHash !==
      createHash("sha256")
        .update(JSON.stringify([value.title, value.text]))
        .digest("hex")
  )
    throw Error("Publication review no longer matches");
  return value;
}
export function receiptKey(marker: string) {
  return "notion.receipt." + createHash("sha256").update(marker).digest("hex");
}
export function readNotionReceipt(
  db: Database.Database,
  marker: string,
): Receipt | undefined {
  const row = db
    .prepare("SELECT value_json FROM workspace_settings WHERE id=?")
    .get(receiptKey(marker)) as { value_json: string } | undefined;
  if (!row) return;
  try {
    const receipt = JSON.parse(row.value_json) as Receipt;
    if (
      !uuid.test(receipt.pageId) ||
      !uuid.test(receipt.parentId) ||
      !/^[a-f0-9]{64}$/.test(receipt.contentHash)
    )
      return;
    const actionRow = db
      .prepare(
        "SELECT payload_json FROM actions WHERE operation_marker=? AND kind='notion_publish'",
      )
      .get(marker) as { payload_json: string } | undefined;
    if (!actionRow) return;
    const payload = publication(JSON.parse(actionRow.payload_json));
    if (
      receipt.parentId !== payload.parentId ||
      (receipt.parentType ?? "page_id") !== (payload.parentType ?? "page_id") ||
      (receipt.titleProperty ?? "title") !==
        (payload.titleProperty ?? "title") ||
      receipt.contentHash !== payload.contentHash
    )
      return;
    return {
      pageId: receipt.pageId,
      parentId: receipt.parentId,
      contentHash: receipt.contentHash,
      ...(receipt.parentType ? { parentType: receipt.parentType } : {}),
      ...(receipt.titleProperty
        ? { titleProperty: receipt.titleProperty }
        : {}),
    };
  } catch {
    return;
  }
}
