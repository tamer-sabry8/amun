import {
  conversationSharePreview,
  ownDataField,
} from "../../security/src/conversation-share.ts";
import type { Redactor } from "../../security/src/redaction.ts";
import type { StowMessage } from "../../contracts/src/stow.ts";
export function stowConversation(
  entries: unknown[],
  redactor: Redactor,
): StowMessage[] {
  const messages: StowMessage[] = [];
  let size = 0;
  for (const entry of entries) {
    const role = ownDataField(ownDataField(entry, "message"), "role");
    if (
      ownDataField(entry, "type") !== "message" ||
      (role !== "user" && role !== "assistant")
    )
      continue;
    const text = conversationSharePreview(
      "Stow",
      [entry],
      redactor,
      true,
    ).text.replace(/^## (User|Assistant)\n\n/, "");
    if (
      !text ||
      text.startsWith("\u2063") ||
      text.startsWith("Run `bin/fm-session-start.sh`")
    )
      continue;
    size += text.length;
    if (size > 262144 || messages.length >= 1000)
      throw Error("Selected branch exceeds Stow review limits");
    messages.push({ role, text });
  }
  return messages;
}
