// The document cards under the latest reply (fixes F1, F3 and F5, approved
// by the owner on 23 November 2026):
// - one card per document: saves of the same title and type show once, the
//   newest, with its version;
// - an empty "Untitled" (made by New document, nothing written yet) shows no
//   card until it has text;
// - the card's status is its control: Draft · Approved · Done;
// - Done (and Verified live) cards fold into "Done (n)";
// - a checklist card opens the checklist panel (the caller decides).
import { useState } from "react";
import type { WorkSnapshot } from "../../../contracts/src/work.ts";
import { Icon } from "../icons.tsx";
import { approvalLabel, approvalOf } from "./document-approval.ts";
import { typeName } from "./rail.tsx";

type Output = WorkSnapshot["library"][number];
export type CardStatus = "Draft" | "Approved" | "Done";

const finished = (item: Output) =>
  /^(done|verified live|delivered|closed)$/i.test(item.status);

/** The cards to show, newest first, and the finished ones folded away. */
export function outputCards(items: Output[]) {
  const seen = new Set<string>();
  const kept = [...items]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .filter((item) => {
      if (/^untitled$/i.test(item.title.trim()) && !item.body.trim())
        return false;
      const key = `${item.type}|${item.title.trim().toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return {
    open: kept.filter((item) => !finished(item)).slice(0, 4),
    done: kept.filter(finished),
  };
}

/** The status word a card shows; a release keeps its stage. */
export function cardStatus(item: Output): string {
  const approval = approvalLabel(approvalOf(item));
  if (approval) return approval;
  return item.status || "Draft";
}

export function OutputCards({
  items,
  pane,
  onOpen,
  onStatus,
}: {
  items: Output[];
  pane: { kind: string; id?: string } | null;
  onOpen(item: Output): void;
  onStatus(item: Output, next: CardStatus): void;
}) {
  const [menu, setMenu] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const { open, done } = outputCards(items);
  const card = (item: Output) => {
    const editable = item.type !== "release_tracker";
    return (
      <div key={item.id} className="rb-inline rb-outcard">
        <span className="row">
          <button
            type="button"
            className="rb-outcard-open grow"
            aria-pressed={pane?.kind === "output" && pane.id === item.id}
            onClick={() => onOpen(item)}
          >
            <Icon name="prd" width={18} height={18} />
            <strong>{item.title}</strong>
          </button>
          {editable ? (
            <span className="rb-status-wrap">
              <button
                type="button"
                className="tag rb-status"
                aria-haspopup="menu"
                aria-expanded={menu === item.id}
                onClick={() => setMenu(menu === item.id ? null : item.id)}
              >
                {cardStatus(item)}
                <Icon name="chevron" width={10} height={10} />
              </button>
              {menu === item.id && (
                <span className="rb-status-menu" role="menu">
                  {(["Draft", "Approved", "Done"] as const).map((next) => (
                    <button
                      key={next}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenu(null);
                        onStatus(item, next);
                      }}
                    >
                      {next}
                      <span className="muted small">
                        {next === "Draft"
                          ? "still being written"
                          : next === "Approved"
                            ? `this version (v${item.version}) is right`
                            : "finished, fold it away"}
                      </span>
                    </button>
                  ))}
                </span>
              )}
            </span>
          ) : (
            <span className="tag">{item.status}</span>
          )}
        </span>
        <span className="note">
          {typeName(item.type)}
          {item.version > 1 ? ` · version ${item.version}` : ""} · opens beside
          the conversation
        </span>
      </div>
    );
  };
  return (
    <>
      {open.map(card)}
      {done.length > 0 && (
        <>
          <button
            type="button"
            className="rb-activity-line"
            aria-expanded={showDone}
            onClick={() => setShowDone(!showDone)}
          >
            Done ({done.length})
            <Icon
              name="chevron"
              width={12}
              height={12}
              style={{ rotate: showDone ? "90deg" : "0deg" }}
            />
          </button>
          {showDone && done.map(card)}
        </>
      )}
    </>
  );
}
