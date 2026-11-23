// What Amun created in Jira, Linear or Azure DevOps for an approved plan, in
// the chat of the request that asked (Idea to Done §4.8; receipt card
// approved by the owner on 23 November 2026). It reuses the chat's document
// card and adds nothing to the prompt box. Partial results say so, and only
// the items that failed can be fixed, through Firstmate.
import { useState } from "react";

export interface ReceiptItem {
  summary: string;
  type: string | null;
  parent: string | null;
  state: "created" | "failed" | "unknown";
  key: string | null;
  url: string | null;
  note: string | null;
}
export interface ReceiptCard {
  kind: "publish-receipt";
  planId: string;
  destination: string;
  request: string | null;
  state: "published" | "partial" | "failed";
  created: number;
  total: number;
  items: ReceiptItem[];
}

export function receiptOf(card: unknown): ReceiptCard | null {
  if (!card || typeof card !== "object") return null;
  const value = card as Partial<ReceiptCard>;
  return value.kind === "publish-receipt" &&
    typeof value.planId === "string" &&
    Array.isArray(value.items)
    ? (value as ReceiptCard)
    : null;
}

const toolName: Record<string, string> = {
  jira: "Jira",
  linear: "Linear",
  ado: "Azure DevOps",
  notion: "Notion",
};

/** Rows shown before "Show all". */
const folded = 3;

export function PublishReceipt({
  card,
  onFix,
}: {
  card: ReceiptCard;
  /** Puts a request to Firstmate in the composer; nothing is sent. */
  onFix(text: string): void;
}) {
  const [all, setAll] = useState(false);
  const tool = toolName[card.destination] ?? card.destination;
  const failed = card.items.filter((item) => item.state !== "created");
  const complete = card.state === "published";
  const title = complete
    ? `Created in ${tool} · ${card.total} ${card.total === 1 ? "item" : "items"}`
    : `Created in ${tool} · ${card.created} of ${card.total}`;
  const shown = all ? card.items : card.items.slice(0, folded);
  return (
    <div className="rb-turn firstmate">
      <div className="rb-inline" role="group" aria-label={title}>
        <span className="row">
          <strong className="grow">{title}</strong>
          <span className={"tag " + (complete ? "good" : "accent")}>
            {complete ? "Done" : `${failed.length} not created`}
          </span>
        </span>
        {!complete && failed[0]?.note && (
          <span className="note">{failed[0].note}</span>
        )}
        <table className="rb-receipt">
          <thead>
            <tr>
              <th>Item</th>
              <th>Created as</th>
              <th>Under</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((item, index) => (
              <tr key={index}>
                <td>{item.summary}</td>
                <td>
                  {item.state === "created" ? (
                    item.url ? (
                      <a href={item.url} target="_blank" rel="noreferrer">
                        {item.key ?? "Open"} ↗
                      </a>
                    ) : (
                      (item.key ?? "Created")
                    )
                  ) : item.state === "failed" ? (
                    <span className="muted">Not created</span>
                  ) : (
                    <span className="muted">Checking</span>
                  )}
                </td>
                <td className="muted">{item.parent ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {card.items.length > folded && (
          <button
            className="link small"
            style={{ justifySelf: "start" }}
            onClick={() => setAll(!all)}
          >
            {all ? "Show fewer" : `Show all ${card.items.length}`}
          </button>
        )}
        {!complete && failed.length > 0 && (
          <button
            className="btn"
            style={{ justifySelf: "start" }}
            onClick={() =>
              onFix(
                `Fix and retry the ${failed.length} ${failed.length === 1 ? "item" : "items"} that were not created in ${tool}: ${failed
                  .map((item) => `“${item.summary}”`)
                  .join(", ")}. Do not redo the ones already created.`,
              )
            }
          >
            Ask Firstmate to fix and retry the {failed.length}
          </button>
        )}
      </div>
    </div>
  );
}
