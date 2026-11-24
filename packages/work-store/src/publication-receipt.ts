import { createHash } from "node:crypto";
import type { Database } from "./sqlite.ts";
import type { Redactor } from "./redaction.ts";

export type PublicationReceiptState =
  "pending" | "accepted" | "unknown" | "skipped";

export interface PublicationReceiptItem {
  id: string;
  state: string;
  remoteId: string | number | null;
  remoteRev: number | null;
  url: string | null;
  note: string | null;
}

export interface PublicationReceiptInput {
  kind: "tracker" | "ado";
  targetId: string;
  destination: string;
  requestRef: string | null;
  items: PublicationReceiptItem[];
}

export interface PublicationReceiptRecord {
  kind: "tracker" | "ado";
  targetId: string;
  requestRef: string;
  fingerprint: string;
  state: "pending" | "accepted" | "unknown";
  attempts: number;
  updatedAt: string;
  error: string | null;
}

export interface PublicationReceiptDelivery {
  state: PublicationReceiptState;
  deduplicated: boolean;
  fingerprint: string;
}

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function canonicalItems(items: PublicationReceiptItem[]) {
  return [...items]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((item) => ({
      id: item.id,
      state: item.state,
      remoteId: item.remoteId,
      remoteRev: item.remoteRev,
      url: item.url,
    }));
}

export function receiptFingerprint(input: PublicationReceiptInput): string {
  return sha256(
    JSON.stringify({
      kind: input.kind,
      targetId: input.targetId,
      destination: input.destination,
      items: canonicalItems(input.items),
    }),
  );
}

export function receiptSettingId(
  kind: "tracker" | "ado",
  targetId: string,
  fingerprint: string,
): string {
  return `pub.receipt.${sha256(`${kind}:${targetId}:${fingerprint}`).slice(0, 32)}`;
}

export function readPublicationReceiptRecord(
  db: Database,
  settingId: string,
): PublicationReceiptRecord | null {
  const row = db
    .prepare("SELECT value_json FROM workspace_settings WHERE id=?")
    .get(settingId) as { value_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value_json) as PublicationReceiptRecord;
  } catch {
    return null;
  }
}

function saveRecord(
  db: Database,
  settingId: string,
  record: PublicationReceiptRecord,
) {
  db.prepare(
    "INSERT INTO workspace_settings(id,value_json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json",
  ).run(settingId, JSON.stringify(record));
}

function formatReceiptPrompt(
  input: PublicationReceiptInput,
  fingerprint: string,
  redactor: Redactor,
): string {
  const safeItems = canonicalItems(input.items).map((item, idx) => {
    const rawNote = input.items[idx]?.note;
    return {
      ...item,
      url: item.url ? redactor.text(item.url) : null,
      note: rawNote ? redactor.text(rawNote).slice(0, 200) : null,
    };
  });
  const payload = {
    kind: input.kind,
    targetId: input.targetId,
    requestRef: input.requestRef,
    destination: redactor.text(input.destination),
    fingerprint: fingerprint.slice(0, 12),
    items: safeItems,
  };
  return redactor.text(
    [
      `[Amun verified publication outcome · ${input.requestRef}]`,
      "Amun already executed and recorded the governed provider write below. This is a factual outcome update for your records only: do not repeat any provider write and no acknowledgement turn is required.",
      JSON.stringify(payload),
    ].join("\n"),
  );
}

/**
 * Durably delivers a verified post-write provider outcome to primary Firstmate.
 * - Skips unlinked legacy receipts with no verified requestRef.
 * - Deduplicates by (kind, targetId, fingerprint) in workspace_settings.
 * - A changed outcome (e.g. partial -> confirmed) has a new fingerprint and delivers again.
 * - Transport failures are persisted as state="unknown" and never rethrown.
 */
export async function deliverPublicationReceipt(
  db: Database,
  redactor: Redactor,
  input: PublicationReceiptInput,
  send: (prompt: string) => Promise<string>,
): Promise<PublicationReceiptDelivery> {
  const fingerprint = receiptFingerprint(input);
  if (!input.requestRef || input.items.length === 0) {
    return { state: "skipped", deduplicated: false, fingerprint };
  }
  const settingId = receiptSettingId(input.kind, input.targetId, fingerprint);
  const existing = readPublicationReceiptRecord(db, settingId);
  if (
    existing &&
    (existing.state === "accepted" || existing.state === "pending")
  ) {
    return { state: existing.state, deduplicated: true, fingerprint };
  }
  const attempts = (existing?.attempts ?? 0) + 1;
  saveRecord(db, settingId, {
    kind: input.kind,
    targetId: input.targetId,
    requestRef: input.requestRef,
    fingerprint,
    state: "pending",
    attempts,
    updatedAt: new Date().toISOString(),
    error: null,
  });
  const prompt = formatReceiptPrompt(input, fingerprint, redactor);
  try {
    await send(prompt);
    saveRecord(db, settingId, {
      kind: input.kind,
      targetId: input.targetId,
      requestRef: input.requestRef,
      fingerprint,
      state: "accepted",
      attempts,
      updatedAt: new Date().toISOString(),
      error: null,
    });
    return { state: "accepted", deduplicated: false, fingerprint };
  } catch (error) {
    const msg = redactor
      .text(error instanceof Error ? error.message : String(error))
      .slice(0, 300);
    saveRecord(db, settingId, {
      kind: input.kind,
      targetId: input.targetId,
      requestRef: input.requestRef,
      fingerprint,
      state: "unknown",
      attempts,
      updatedAt: new Date().toISOString(),
      error: msg,
    });
    return { state: "unknown", deduplicated: false, fingerprint };
  }
}
