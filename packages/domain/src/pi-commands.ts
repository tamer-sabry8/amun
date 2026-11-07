/** Pinned Pi 1.4.0 built-ins require native actions; get_commands is resources only. */
export const builtinPiCommands = [
  "settings",
  "model",
  "thinking",
  "scoped-models",
  "login",
  "logout",
  "llama",
  "new",
  "resume",
  "name",
  "session",
  "tree",
  "fork",
  "clone",
  "compact",
  "import",
  "copy",
  "export",
  "share",
  "bug",
  "trust",
  "mcp",
  "reload",
  "hotkeys",
  "changelog",
  "quit",
  "debug",
].map((name) => ({
  name,
  source: "builtin" as const,
  description: name.replaceAll("-", " "),
}));
export interface NativePiCommand {
  name: string;
  source: "builtin" | "extension" | "prompt" | "skill";
  description: string;
}
export function commandCatalog(resources: unknown): NativePiCommand[] {
  if (!Array.isArray(resources) || resources.length > 512)
    throw Error("Invalid command catalog");
  const catalog = new Map<string, NativePiCommand>(
    builtinPiCommands.map((command) => [command.name, command]),
  );
  for (const item of resources) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.name !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(item.name) ||
      !["extension", "prompt", "skill"].includes(item.source) ||
      (item.description !== undefined &&
        (typeof item.description !== "string" ||
          item.description.length > 1024))
    )
      throw Error("Invalid resource command");
    if (!catalog.has(item.name))
      catalog.set(item.name, {
        name: item.name,
        source: item.source,
        description: item.description ?? "",
      });
  }
  return [...catalog.values()];
}
export async function routePiInput(
  input: string,
  resources: unknown,
  actions: {
    native(name: string, argument: string): Promise<void>;
    prompt(text: string): Promise<void>;
  },
): Promise<void> {
  if (!input.trim() || input.length > 16384 || input.includes("\0"))
    throw Error("Invalid Pi input");
  const text = input.trim();
  if (text.startsWith("!!"))
    return actions.native("shell-private", text.slice(2).trim());
  if (text.startsWith("!"))
    return actions.native("shell-context", text.slice(1).trim());
  if (!text.startsWith("/")) return actions.prompt(input);
  const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text);
  if (
    match?.[1] === "updatefirstmate" ||
    match?.[1] === "skill:updatefirstmate"
  )
    return actions.native("updatefirstmate", match[2] ?? "");
  const command = commandCatalog(resources).find(
    (item) => item.name === match?.[1],
  );
  if (!command) throw Error("Command not available in this session");
  if (command.source === "builtin")
    return actions.native(command.name, match?.[2] ?? "");
  return actions.prompt(text);
}
