/**
 * A portable reference to a session, so the same work can be opened from
 * the chat or from a terminal. It carries an id only, never content.
 */

export const surfaces = ["chat", "cli", "automation"] as const;
export type Surface = (typeof surfaces)[number];

const prefix = "amun://session/";
const idPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function sessionReference(sessionId: string): string {
  if (!idPattern.test(sessionId)) throw Error("Invalid session id");
  return prefix + sessionId;
}

/** Accepts a full reference or a bare id. */
export function parseSessionReference(text: string): string {
  const value = text.trim();
  const id = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  if (!idPattern.test(id)) throw Error("That is not a session reference");
  return id;
}

export interface CliCommand {
  name:
    "status" | "events" | "search" | "say" | "decide" | "ref" | "open" | "help";
  session?: string;
  text?: string;
  eventId?: string;
  decision?: "approve" | "reject";
  sources?: string[];
  json: boolean;
}

export const cliUsage = [
  "amun session status <ref>              What is done, pending, failed or waiting",
  "amun session events <ref> [--source s] The recorded history, optionally by source",
  "amun session search <ref> <words>      Find events in the history",
  "amun session say <ref> <message>       Add an instruction to the session",
  "amun session decide <ref> <event> approve|reject [reason]",
  "amun session open <ref>                Record that work continues in the chat",
  "amun session ref <ref>                 Print the reference to copy or script",
  "Add --json to any command for machine-readable output.",
].join("\n");

/** Parses arguments after "amun session". Throws a message fit to print. */
export function parseCli(argv: readonly string[]): CliCommand {
  const json = argv.includes("--json");
  const sources: string[] = [];
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--json") continue;
    if (arg === "--source") {
      const value = argv[++i];
      if (!value) throw Error("--source needs a value");
      sources.push(value);
    } else if (arg.startsWith("--")) throw Error("Unknown option " + arg);
    else words.push(arg);
  }
  const [name, ref, ...rest] = words;
  if (!name || name === "help") return { name: "help", json };
  if (
    !["status", "events", "search", "say", "decide", "ref", "open"].includes(
      name,
    )
  )
    throw Error(`Unknown command "${name}". Try: amun session help`);
  if (!ref) throw Error("Give a session reference");
  const session = parseSessionReference(ref);
  const command = name as CliCommand["name"];
  if (command === "search" || command === "say") {
    const text = rest.join(" ").trim();
    if (!text)
      throw Error(
        command === "say"
          ? "Give the message to add"
          : "Give words to search for",
      );
    return { name: command, session, text, json };
  }
  if (command === "decide") {
    const [eventId, decision, ...reason] = rest;
    if (!eventId || (decision !== "approve" && decision !== "reject"))
      throw Error("Use: decide <ref> <event> approve|reject [reason]");
    return {
      name: command,
      session,
      eventId,
      decision,
      text: reason.join(" "),
      json,
    };
  }
  return {
    name: command,
    session,
    json,
    ...(sources.length ? { sources } : {}),
  };
}
