import {
  conversationSharePreview,
  ownDataField,
} from "../../security/src/conversation-share.ts";
import type { Redactor } from "../../security/src/redaction.ts";
export function ahoyRecap(entries: unknown[], redactor: Redactor) {
  let last = -1;
  for (const [index, entry] of entries.entries()) {
    const message = ownDataField(entry, "message");
    if (
      ownDataField(entry, "type") !== "message" ||
      ownDataField(message, "role") !== "user"
    )
      continue;
    const parts = ownDataField(message, "content");
    const text =
      typeof parts === "string"
        ? parts
        : Array.isArray(parts)
          ? parts
              .map((p) =>
                ownDataField(p, "type") === "text"
                  ? ownDataField(p, "text")
                  : "",
              )
              .filter((p) => typeof p === "string")
              .join("")
          : "";
    if (
      text.startsWith("\u2063FIRSTMATE_OP:") ||
      text.startsWith("\u2063Supervisor escalate (") ||
      text ===
        "Run `bin/fm-session-start.sh` now, exactly once, before executing any other instructions."
    )
      continue;
    last = index;
  }
  if (last < 0) return null;
  const visible = entries
    .slice(last + 1)
    .filter(
      (e) => ownDataField(ownDataField(e, "message"), "role") === "assistant",
    );
  const recap = conversationSharePreview(
    "Since your last message",
    visible,
    redactor,
    true,
  ).text;
  return (
    recap || "Nothing happened in the conversation after your previous message."
  );
}
