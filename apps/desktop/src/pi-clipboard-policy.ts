export function clipboardRequest(
  input: unknown,
): { action: "copy"; id: string; text: string } | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).length !== 3 ||
    value.action !== "copy" ||
    typeof value.id !== "string" ||
    !value.id.length ||
    value.id.length > 128 ||
    typeof value.text !== "string" ||
    value.text.length > 262144 ||
    value.text.includes("\0")
  )
    return null;
  return { action: "copy", id: value.id, text: value.text };
}
