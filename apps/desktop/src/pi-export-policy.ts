export function exportRequest(
  input: unknown,
): { id: string; format: "html" | "jsonl"; text: string } | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).length !== 3 ||
    typeof value.id !== "string" ||
    !value.id.length ||
    value.id.length > 128 ||
    (value.format !== "html" && value.format !== "jsonl") ||
    typeof value.text !== "string" ||
    Buffer.byteLength(value.text) > 524288 ||
    value.text.includes("\0")
  )
    return null;
  return { id: value.id, format: value.format, text: value.text };
}
