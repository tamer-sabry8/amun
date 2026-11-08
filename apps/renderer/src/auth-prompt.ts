export function canSubmitAuthPrompt(
  prompt: { method: string; options: readonly { id: string; label: string }[] },
  value: string,
): boolean {
  if (value.length > 65536) return false;
  if (prompt.method === "text") return true;
  if (prompt.method === "select")
    return prompt.options.some((option) => option.id === value);
  return value.length > 0;
}
