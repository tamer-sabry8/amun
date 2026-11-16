import { ownDataField } from "../../security/src/conversation-share.ts";
import type { Redactor } from "../../security/src/redaction.ts";
const partialNotice =
  "\n\n[Partial: this reply was too long and the rest is NOT included. Any unfinished action was removed.]";
const VIEW_TEXT_LIMIT = 240000,
  PART_TEXT_LIMIT = 262144,
  MAX_ENTRIES = 1000,
  MAX_PARTS = 10000;
type ViewMessage = { label: string; text: string; assistant: boolean };
function boundedConversationText(
  title: string,
  entries: unknown,
  redactor: Redactor,
) {
  if (title.length > 256 || !Array.isArray(entries))
    throw Error("Conversation exceeds review limits");
  let omittedItems = Math.max(0, entries.length - MAX_ENTRIES),
    parts = 0,
    oversized = false;
  const messages: ViewMessage[] = [];
  let replyCount = 0,
    latestRaw: string | null = null;
  for (const entry of entries.slice(0, -MAX_ENTRIES))
    if (
      ownDataField(entry, "type") === "message" &&
      ownDataField(ownDataField(entry, "message"), "role") === "assistant"
    )
      replyCount++;
  for (const entry of entries.slice(-MAX_ENTRIES)) {
    const message = ownDataField(entry, "message"),
      role = ownDataField(message, "role");
    if (
      ownDataField(entry, "type") !== "message" ||
      (role !== "user" && role !== "assistant")
    ) {
      omittedItems++;
      continue;
    }
    if (role === "assistant") {
      replyCount++;
      latestRaw = null;
    }
    const content = ownDataField(message, "content"),
      raw: string[] = [];
    let skip = false;
    for (const part of typeof content === "string"
      ? [content]
      : Array.isArray(content)
        ? content
        : []) {
      if (++parts > MAX_PARTS) {
        omittedItems++;
        continue;
      }
      const value =
        typeof part === "string" ? part : ownDataField(part, "text");
      if (
        typeof part !== "string" &&
        (ownDataField(part, "type") !== "text" || typeof value !== "string")
      ) {
        omittedItems++;
        continue;
      }
      if ((value as string).length > PART_TEXT_LIMIT) {
        oversized = skip = true;
        continue;
      }
      raw.push(value as string);
    }
    if (skip) {
      omittedItems++;
      continue;
    }
    if (role === "assistant") latestRaw = raw.join("\n");
    messages.push({
      label: role === "user" ? "User" : "Assistant",
      text: raw.join("\n"),
      assistant: role === "assistant",
    });
  }
  const label = (m: ViewMessage) => "## " + m.label + "\n\n";
  const chosen = new Set<number>();
  let used = 0;
  const take = (i: number, force: boolean) => {
    const m = messages[i];
    if (!m || chosen.has(i)) return;
    const body = redactor.text(m.text);
    if (!body.trim()) return;
    const room = VIEW_TEXT_LIMIT - used - (used ? 2 : 0) - label(m).length;
    if (body.length > room) {
      if (!force || room <= partialNotice.length) return;
      let cut = body.slice(0, room - partialNotice.length);
      // A cut can leave an action block open; its syntax is removed so it
      // can never be read as a complete action.
      const open = cut.lastIndexOf("```amun");
      if (open >= 0 && !cut.includes("```", open + 7)) cut = cut.slice(0, open);
      m.text = cut + partialNotice;
    } else m.text = body;
    used += (used ? 2 : 0) + label(m).length + m.text.length;
    chosen.add(i);
  };
  // The newest assistant reply is kept first. If it still does not fit, it is
  // cut and says so, and an unfinished action is never left in it.
  for (let i = messages.length - 1; i >= 0; i--)
    if (messages[i]!.assistant) {
      take(i, true);
      break;
    }
  for (let i = messages.length - 1; i >= 0; i--) take(i, false);
  if (oversized && !chosen.size)
    throw Error("Conversation exceeds review limits");
  const text = messages
    .flatMap((m, i) => (chosen.has(i) ? [label(m) + m.text] : []))
    .join("\n\n");
  omittedItems += messages.length - chosen.size;
  // The newest reply is read on its own, so what the owner sees in the
  // bounded transcript never decides which reply counts as new.
  let latestReply: string | null = null;
  if (latestRaw !== null) {
    latestReply = redactor.text(latestRaw);
    if (latestReply.length > VIEW_TEXT_LIMIT) {
      latestReply = latestReply.slice(
        0,
        VIEW_TEXT_LIMIT - partialNotice.length,
      );
      const open = latestReply.lastIndexOf("```amun");
      if (open >= 0 && !latestReply.includes("```", open + 7))
        latestReply = latestReply.slice(0, open);
      latestReply += partialNotice;
    }
  }
  return {
    title: redactor.text(title || "Amun conversation"),
    text,
    omittedItems,
    replyCount,
    latestReply,
  };
}
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
  const preview = boundedConversationText(title, entries, redactor);
  return {
    kind: "conversation" as const,
    sessionId,
    model,
    title: preview.title,
    text: preview.text,
    omittedItems: preview.omittedItems,
    replyCount: preview.replyCount,
    ...(preview.latestReply === null
      ? {}
      : { latestReply: preview.latestReply }),
    ...conversationDetails(entries, redactor),
  };
}
