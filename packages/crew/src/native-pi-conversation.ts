import { conversationSharePreview } from "../../security/src/conversation-share.ts";
import type { Redactor } from "../../security/src/redaction.ts";
export function nativeConversationView(
  sessionId: string,
  title: string,
  entries: unknown,
  redactor: Redactor,
) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      sessionId,
    )
  )
    throw Error("Invalid session identity");
  const preview = conversationSharePreview(title, entries, redactor, true);
  return {
    kind: "conversation" as const,
    sessionId,
    title: preview.title,
    text: preview.text,
    omittedItems: preview.omittedItems,
  };
}
