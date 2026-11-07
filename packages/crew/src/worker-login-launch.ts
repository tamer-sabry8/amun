import { isAbsolute, resolve } from "node:path";
export function workerLoginRequest(input: unknown): "codex" | "claude" | null {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    !("tool" in input) ||
    (input.tool !== "codex" && input.tool !== "claude")
  )
    return null;
  return input.tool;
}
export function workerLoginScript(
  binary: string,
  helper: string,
  tool: "codex" | "claude",
) {
  for (const path of [binary, helper])
    if (!isAbsolute(path) || resolve(path) !== path || /[\0\r\n]/.test(path))
      throw Error("Unsafe login path");
  if (tool !== "codex" && tool !== "claude")
    throw Error("Unsupported login tool");
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  return (
    "#!/bin/zsh\nexec /usr/bin/env ELECTRON_RUN_AS_NODE=1 " +
    [binary, helper, tool].map(quote).join(" ") +
    "\n"
  );
}
