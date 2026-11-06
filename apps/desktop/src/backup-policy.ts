export function backupRequest(
  input: unknown,
): { action: "export" | "restore"; password: string } | null {
  if (
    !input ||
    typeof input !== "object" ||
    Object.keys(input).length !== 2 ||
    !("action" in input) ||
    !("password" in input) ||
    (input.action !== "export" && input.action !== "restore") ||
    typeof input.password !== "string" ||
    input.password.length < 12 ||
    input.password.length > 1024
  )
    return null;
  return { action: input.action, password: input.password };
}
