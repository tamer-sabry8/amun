import {
  conversationSharePreview,
  ownDataField,
} from "../../security/src/conversation-share.ts";
import type { Redactor } from "../../security/src/redaction.ts";
function conversationDetails(entries: unknown, redactor: Redactor) {
  const tool: string[] = [],
    summaries: string[] = [];
  if (!Array.isArray(entries)) return {};
  for (const entry of entries.slice(-256)) {
    const m =
      ownDataField(entry, "type") === "message"
        ? ownDataField(entry, "message")
        : undefined;
    const content = ownDataField(m, "content"),
      role = ownDataField(m, "role"),
      api = ownDataField(m, "api"),
      toolName = ownDataField(m, "toolName");
    if (!Array.isArray(content)) continue;
    for (const part of content.slice(0, 64)) {
      const type = ownDataField(part, "type"),
        text = ownDataField(part, "text"),
        signature = ownDataField(part, "thinkingSignature");
      if (
        role === "toolResult" &&
        type === "text" &&
        typeof text === "string" &&
        text.length <= 262144 &&
        tool.length < 32
      ) {
        const name =
          typeof toolName === "string" && /^[\w.:-]{1,96}$/.test(toolName)
            ? toolName
            : "Tool";
        tool.push(
          name +
            " · " +
            (ownDataField(m, "isError") === true ? "error" : "result") +
            "\n" +
            redactor.text(text).slice(0, 2048),
        );
      }
      if (
        role !== "assistant" ||
        (api !== "openai-responses" && api !== "openai-codex-responses") ||
        type !== "thinking" ||
        typeof signature !== "string" ||
        signature.length > 65536 ||
        summaries.length >= 32
      )
        continue;
      try {
        const item = JSON.parse(signature);
        if (item?.type !== "reasoning" || !Array.isArray(item.summary))
          continue;
        for (const row of item.summary.slice(0, 32)) {
          if (
            row?.type === "summary_text" &&
            typeof row.text === "string" &&
            summaries.length < 32
          )
            summaries.push(redactor.text(row.text).slice(0, 2048));
        }
      } catch {
        /* An opaque provider signature has no displayable summary. */
      }
    }
  }
  return {
    ...(tool.length ? { toolOutput: tool.join("\n\n").slice(0, 32768) } : {}),
    ...(summaries.length
      ? { summaries: summaries.join("\n\n").slice(0, 32768) }
      : {}),
  };
}
export function nativeConversationView(
  sessionId: string,
  title: string,
  entries: unknown,
  redactor: Redactor,
  model: string | null = null,
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
    model,
    title: preview.title,
    text: preview.text,
    omittedItems: preview.omittedItems,
    ...conversationDetails(entries, redactor),
  };
}
