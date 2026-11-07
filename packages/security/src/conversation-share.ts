import { createHash } from "node:crypto";
import { Redactor } from "./redaction.ts";
export function registerCredentialSecrets(
  redactor: Redactor,
  credential: unknown,
) {
  let count = 0;
  const walk = (value: unknown, depth: number) => {
    if (depth > 8 || ++count > 1024)
      throw Error("Credential redaction exceeds limits");
    if (typeof value === "string") {
      if (value) redactor.register(value);
      return;
    }
    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === undefined
    )
      return;
    if (
      typeof value !== "object" ||
      (Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null &&
        !Array.isArray(value))
    )
      throw Error("Invalid credential structure");
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if (key === "type" || key === "length") continue;
      if (!("value" in descriptor)) throw Error("Invalid credential structure");
      walk(descriptor.value, depth + 1);
    }
  };
  walk(credential, 0);
}
export function conversationSharePreview(
  title: string,
  entries: unknown,
  redactor: Redactor,
  allowEmpty = false,
) {
  if (title.length > 256 || !Array.isArray(entries) || entries.length > 1000)
    throw Error("Conversation exceeds review limits");
  const data = (value: unknown, key: string): unknown => {
    if (!value || typeof value !== "object") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  };
  const parts: string[] = [];
  let omittedItems = 0,
    totalText = 0,
    contentItems = 0;
  const safeText = (text: string) => {
    totalText += text.length;
    if (totalText > 262144) throw Error("Conversation exceeds review limits");
    return redactor.text(text);
  };
  for (const entry of entries) {
    const message = data(entry, "message"),
      role = data(message, "role");
    if (
      data(entry, "type") !== "message" ||
      (role !== "user" && role !== "assistant")
    ) {
      omittedItems++;
      continue;
    }
    const content = data(message, "content");
    let text = "";
    if (typeof content === "string") text = safeText(content);
    else if (Array.isArray(content))
      text = content
        .flatMap((part) => {
          if (++contentItems > 10000)
            throw Error("Conversation exceeds review limits");
          const value = data(part, "text");
          if (data(part, "type") === "text" && typeof value === "string")
            return [safeText(value)];
          omittedItems++;
          return [];
        })
        .join("\n");
    if (text.trim())
      parts.push(
        "## " + (role === "user" ? "User" : "Assistant") + "\n\n" + text,
      );
  }
  if (!parts.length && !allowEmpty)
    throw Error("No conversation text to share");
  const text = parts.join("\n\n"),
    safeTitle = redactor.text(title || "Amun conversation");
  if (text.length > 262144) throw Error("Conversation exceeds review limits");
  return {
    kind: "notion-preview" as const,
    title: safeTitle,
    text,
    omittedItems,
    contentHash: createHash("sha256")
      .update(JSON.stringify([safeTitle, text]))
      .digest("hex"),
  };
}
