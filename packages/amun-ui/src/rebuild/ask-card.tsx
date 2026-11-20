// "Ask about Gitex" (owner's chat handoff, approved 20 November 2026): a
// fresh chat in the card's folder shows a compact attachment above the text.
// Clicking it shows exactly what will go with the first message. Opening the
// chat sends nothing; the first message carries the card as it was.
import { useRef, useState } from "react";
import { Icon } from "../icons.tsx";
import type { AskCard } from "./chat-memory.ts";
import { useDismiss } from "./use-dismiss.ts";

export function AskAttachment({
  card,
  sent = false,
}: {
  card: Pick<AskCard, "label" | "fields">;
  /** On a message already sent: what went with it. */
  sent?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const roots = useRef([button, panel]).current;
  useDismiss(open, roots, () => setOpen(false));
  const [name, ...rest] = card.label.split(" · ");
  return (
    <span className="rb-ask-card">
      <button
        ref={button}
        type="button"
        className="chip"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        <Icon name="artifacts" width={13} height={13} />
        <strong>{name}</strong>
        {rest.length > 0 && <span>· {rest.join(" · ")}</span>}
      </button>
      {open && (
        <div
          ref={panel}
          className="rb-ask-pop"
          role="dialog"
          aria-label={`What goes with ${sent ? "this" : "your first"} message`}
        >
          <strong>
            {sent ? "Sent with this message" : "Sent with your first message"}
          </strong>
          <dl>
            {card.fields.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="note">
            {sent
              ? "The card as it was when you asked."
              : "The card as it is now. Opening this chat sent nothing."}
          </p>
        </div>
      )}
    </span>
  );
}

/** The card message saved with the owner's first message, if any. */
export function askCardOf(
  card: unknown,
): Pick<AskCard, "label" | "fields"> | null {
  if (!card || typeof card !== "object") return null;
  const value = card as { kind?: unknown; label?: unknown; fields?: unknown };
  if (value.kind !== "ask-card" || typeof value.label !== "string") return null;
  const fields = Array.isArray(value.fields)
    ? value.fields.filter(
        (item): item is [string, string] =>
          Array.isArray(item) &&
          typeof item[0] === "string" &&
          typeof item[1] === "string",
      )
    : [];
  return { label: value.label, fields };
}
