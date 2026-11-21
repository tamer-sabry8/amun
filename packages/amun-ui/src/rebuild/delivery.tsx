// A delivered document in a chat (owner's chat handoff, approved 20 November
// 2026): a Firstmate reply at the bottom with the document, opening the exact
// version it delivered, and a link back to the request it answers when that
// link is confirmed.
import { useEffect, useRef, useState } from "react";
import { FirstmateMark } from "./firstmate-mark.tsx";
import { Icon } from "../icons.tsx";

export interface DeliveredCard {
  kind: "delivered";
  outputId: string;
  title: string;
  version: number;
  /** The Amun request reference it answers, when confirmed. */
  request?: string | null;
}
export function deliveredOf(card: unknown): DeliveredCard | null {
  if (!card || typeof card !== "object") return null;
  const value = card as Partial<DeliveredCard>;
  return value.kind === "delivered" &&
    typeof value.outputId === "string" &&
    typeof value.title === "string" &&
    typeof value.version === "number"
    ? (value as DeliveredCard)
    : null;
}

export function DeliveredReply({
  card,
  available,
  request,
  onOpen,
  onRequest,
  named = true,
}: {
  /** False when Firstmate's reply right above already carries its name. */
  named?: boolean;
  card: DeliveredCard;
  /** False when the document is no longer in the Library. */
  available: boolean;
  /** The words of the request it answers, when confirmed. */
  request: string | null;
  onOpen(): void;
  onRequest(): void;
}) {
  return (
    <div className="rb-turn firstmate">
      <div className="rb-msg firstmate rb-delivered">
        {named && (
          <span className="who">
            <FirstmateMark size={18} />
            Firstmate
          </span>
        )}
        <button
          className="doc"
          onClick={onOpen}
          disabled={!available}
          title={available ? `Open ${card.title}, version ${card.version}` : ""}
        >
          <span className="ic" aria-hidden="true">
            <Icon name="prd" width={18} height={18} />
          </span>
          <span className="what">
            <strong>{card.title}</strong>
            <span className="muted small">Version {card.version}</span>
          </span>
        </button>
        {!available && (
          <span className="note warn">
            This document is no longer in the Library. Ask Firstmate for a
            readable copy.
          </span>
        )}
        {request && (
          <span className="from muted small">
            From your request:{" "}
            <button className="link" onClick={onRequest}>
              “{request.length > 70 ? request.slice(0, 67) + "…" : request}”
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

export interface RequestView {
  ref: string;
  status:
    | "sent"
    | "queued"
    | "waiting"
    | "working"
    | "needs-decision"
    | "failed"
    | "delivered";
  role: string;
  detail: string;
  parts: number;
  updatedAt: string;
  projectAreaId: string | null;
  changeToAreaId: string | null;
  changeState: "" | "requested" | "refused";
}

/**
 * One quiet line under the owner's message: where its request stands, in
 * Firstmate's own reported words. Clicking it shows who has it, what was
 * delivered and any change of project asked for.
 */
export function RequestLine({
  request,
  deliveries,
  replyId,
  line,
  project,
  changeTo,
  onShow,
}: {
  request: RequestView;
  replyId: string | null;
  deliveries: { messageId: string; title: string; version: number }[];
  line: string;
  /** The confirmed project's name; null for none. */
  project: string | null;
  changeTo: string | null;
  onShow(messageId: string): void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrap.current?.contains(event.target))
        setOpen(false);
    };
    const dismissKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        wrap.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissKey);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissKey);
    };
  }, [open]);
  const change =
    request.changeState === "requested"
      ? `Change requested · ${changeTo ?? "no project"}`
      : request.changeState === "refused"
        ? `Firstmate kept it in ${project ?? "its project"}`
        : null;
  const destination =
    request.status === "delivered"
      ? (replyId ?? deliveries.at(-1)?.messageId)
      : null;
  const text = [
    request.status === "delivered" && !destination ? "Ready" : line,
    change,
  ]
    .filter(Boolean)
    .join(" · ");
  if (!text) return null;
  const tone =
    request.status === "delivered"
      ? "ready"
      : request.status === "needs-decision"
        ? "ask"
        : request.status === "failed"
          ? "bad"
          : request.status === "queued" || request.status === "waiting"
            ? "wait"
            : "busy";
  return (
    <span className="rb-req-wrap" ref={wrap}>
      <button
        className={"rb-req " + tone}
        aria-expanded={destination ? undefined : open}
        onClick={() => (destination ? onShow(destination) : setOpen(!open))}
      >
        <i aria-hidden="true" />
        <span>{text}</span>
        <Icon name="chevron" width={12} height={12} />
      </button>
      {open && (
        <div className="rb-req-pop" role="group" aria-label="Request details">
          <dl>
            <div>
              <dt>Now</dt>
              <dd>{line || "Sent to Firstmate"}</dd>
            </div>
            {request.role && (
              <div>
                <dt>Who has it</dt>
                <dd>{request.role}</dd>
              </div>
            )}
            <div>
              <dt>Project</dt>
              <dd>{project ?? "None (General)"}</dd>
            </div>
            {change && (
              <div>
                <dt>Change</dt>
                <dd>{change}</dd>
              </div>
            )}
            <div>
              <dt>Last report</dt>
              <dd>
                {new Date(request.updatedAt).toLocaleString("en-GB", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </dd>
            </div>
          </dl>
          {deliveries.length > 0 && (
            <ul>
              {deliveries.map((item) => (
                <li key={item.messageId}>
                  <button
                    className="link"
                    onClick={() => onShow(item.messageId)}
                  >
                    {item.title} · version {item.version}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="note">Reference {request.ref}</p>
        </div>
      )}
    </span>
  );
}
