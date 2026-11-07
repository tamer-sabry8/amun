export const nativeCommandNames = [
  "mcp",
  "updatefirstmate",
  "session",
  "settings",
  "login",
  "logout",
  "new",
  "resume",
  "fork",
  "clone",
  "tree",
  "model",
  "thinking",
  "scoped-models",
  "name",
  "copy",
  "export",
  "share",
  "bug",
  "debug",
  "compact",
  "import",
  "reload",
  "trust",
  "changelog",
  "hotkeys",
  "quit",
];
export function composerCommand(input: string) {
  if (input.length > 12000 || input.includes("\0")) return null;
  const normalized = input
    .trim()
    .replace(/^\/skill:updatefirstmate(?=\s|$)/, "/updatefirstmate");
  const match = /^\/([a-z][a-z-]*)(?:\s+([\s\S]*))?$/.exec(normalized);
  if (!match || !nativeCommandNames.includes(match[1]!)) return null;
  return { name: match[1]!, argument: match[2] ?? "" };
}

export function piModelShortcut(
  event: Pick<
    KeyboardEvent,
    | "key"
    | "ctrlKey"
    | "shiftKey"
    | "metaKey"
    | "altKey"
    | "repeat"
    | "isComposing"
  >,
) {
  if (
    !event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.isComposing ||
    event.repeat
  )
    return null;
  if (event.key.toLowerCase() === "p")
    return event.shiftKey ? "backward" : "forward";
  if (event.key.toLowerCase() === "l" && !event.shiftKey) return "select";
  return null;
}
