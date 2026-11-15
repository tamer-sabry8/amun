export const nativeCommandNames = [
  "mcp",
  "bearings",
  "afk",
  "quiet",
  "ahoy",
  "stow",
  "calm",
  "supervision-model",
  "updatefirstmate",
  "session",
  "settings",
  "llama",
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
    .replace(
      /^\/skill:(bearings|updatefirstmate|afk|quiet|ahoy|stow)(?=\s|$)/,
      "/$1",
    );
  const match = /^\/([a-z][a-z-]*)(?:\s+([\s\S]*))?$/.exec(normalized);
  if (!match || !nativeCommandNames.includes(match[1]!)) return null;
  return { name: match[1]!, argument: match[2] ?? "" };
}

/** Firstmate's built-in skills, with one plain line each (upstream README). */
export const firstmateCommands = [
  {
    name: "afk",
    hint: "",
    description: "Keep an eye on things while you step away",
  },
  {
    name: "quiet",
    hint: "",
    description: "Hold routine updates while you keep chatting",
  },
  {
    name: "ahoy",
    hint: "",
    description: "Catch up on what happened and what still needs you",
  },
  {
    name: "bearings",
    hint: "[file] [include PRs]",
    description: "A short digest of where everything stands",
  },
  {
    name: "updatefirstmate",
    hint: "",
    description: "Check for a Firstmate update, with your approval",
  },
  {
    name: "stow",
    hint: "",
    description: "Save what this session learned to Firstmate's memory",
  },
  {
    name: "calm",
    hint: "",
    description: "Show a quieter view of the conversation",
  },
  {
    name: "supervision-model",
    hint: "",
    description: "See or change how Firstmate supervises",
  },
];

/** Only the Firstmate skills, parsed with the same rules as the legacy panel. */
export function firstmateCommand(input: string) {
  const parsed = composerCommand(input);
  return parsed && firstmateCommands.some(({ name }) => name === parsed.name)
    ? parsed
    : null;
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
