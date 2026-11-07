export const nativeCommandNames = [
  "mcp",
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
  const match = /^\/([a-z][a-z-]*)(?:\s+([\s\S]*))?$/.exec(input.trim());
  if (!match || !nativeCommandNames.includes(match[1]!)) return null;
  return { name: match[1]!, argument: match[2] ?? "" };
}
