// Council (Roast Room inside Amun): commands, roster composition, the Chair
// invocation, update classification and theme mapping. Pure logic; the
// filesystem side lives in packages/council.
// Plan: Roast_Room_Integration_Plan.md §1, §3–§7.

export type CouncilCommand =
  | {
      kind: "council";
      decision: string;
      mode: "quick" | "full" | "seats" | "all";
      seats: string[];
    }
  | { kind: "ask"; seat: string; question: string }
  | { kind: "board"; instruction: string }
  | {
      kind: "newroaster";
      name: string;
      depth: "quick" | "default" | "deep";
      pillar: string | null;
      makeDefault: boolean;
    }
  | { kind: "portrait"; name: string }
  | { kind: "error"; message: string };

export const councilCommands = [
  {
    name: "roast-room",
    hint: "<decision> [--quick | --seats a,b,c | --all]",
    description: "Put a decision to the Council",
  },
  {
    name: "roast-room ask",
    hint: "<seat> <question>",
    description: "Ask one advisor, no scoring",
  },
  {
    name: "roast-room board",
    hint: "[change in plain words]",
    description: "See or change the default board",
  },
  {
    name: "newroaster",
    hint: '<full name> [--quick | --deep] [--pillar "…"] [--default]',
    description: "Add an advisor from sourced material",
  },
  {
    name: "newroaster portrait",
    hint: "<name>",
    description: "Redo an advisor's portrait",
  },
] as const;

const flagValue = (text: string, flag: string) => {
  const match = new RegExp(`--${flag}\\s+(?:"([^"]*)"|(\\S+))`).exec(text);
  return match ? (match[1] ?? match[2] ?? "") : null;
};
const strip = (text: string) =>
  text
    .replace(/--(?:seats|pillar)\s+(?:"[^"]*"|\S+)/g, "")
    .replace(/--[a-z-]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Parses the composer text for the four Council commands. Null when it is not one. */
export function parseCouncilCommand(
  input: string,
  options: { defaultMode?: "quick" | "full" } = {},
): CouncilCommand | null {
  const text = input.trim();
  const roast = /^\/roast-room(?:\s+([\s\S]*))?$/.exec(text);
  if (roast) {
    const rest = (roast[1] ?? "").trim();
    const ask = /^ask\s+(\S+)\s+([\s\S]+)$/.exec(rest);
    if (ask)
      return {
        kind: "ask",
        seat: ask[1]!.toLowerCase(),
        question: ask[2]!.trim(),
      };
    if (/^ask\b/.test(rest))
      return {
        kind: "error",
        message:
          "Name an advisor and a question: /roast-room ask <seat> <question>",
      };
    if (/^board\b/.test(rest))
      return { kind: "board", instruction: rest.slice(5).trim() };
    const seatsFlag = flagValue(rest, "seats");
    const seats = seatsFlag
      ? seatsFlag
          .split(",")
          .map((seat) => seat.trim().toLowerCase())
          .filter(Boolean)
      : [];
    const flags = [
      /--quick\b/.test(rest),
      seatsFlag !== null,
      /--all\b/.test(rest),
    ];
    if (flags.filter(Boolean).length > 1)
      return {
        kind: "error",
        message: "Choose one of --quick, --seats or --all.",
      };
    if (seatsFlag !== null && !seats.length)
      return {
        kind: "error",
        message: "List the seats after --seats, separated by commas.",
      };
    const decision = strip(rest);
    if (!decision)
      return {
        kind: "error",
        message: "Describe the decision you want the Council to weigh.",
      };
    return {
      kind: "council",
      decision,
      seats,
      mode: flags[0]
        ? "quick"
        : flags[1]
          ? "seats"
          : flags[2]
            ? "all"
            : // Quick is Amun's default (Q46); a full council is one tap away.
              (options.defaultMode ?? "quick"),
    };
  }
  const roaster = /^\/newroaster(?:\s+([\s\S]*))?$/.exec(text);
  if (roaster) {
    const rest = (roaster[1] ?? "").trim();
    const portrait = /^portrait\s+([\s\S]+)$/.exec(rest);
    if (portrait) return { kind: "portrait", name: portrait[1]!.trim() };
    const name = strip(rest);
    if (!name)
      return { kind: "error", message: "Give the advisor's full name." };
    return {
      kind: "newroaster",
      name,
      depth: /--quick\b/.test(rest)
        ? "quick"
        : /--deep\b/.test(rest)
          ? "deep"
          : "default",
      pillar: flagValue(rest, "pillar"),
      makeDefault: /--default\b/.test(rest),
    };
  }
  return null;
}

/** The slash command handed to Claude Code, exactly as upstream expects it. */
export function upstreamCommand(command: CouncilCommand): string | null {
  switch (command.kind) {
    case "council":
      return (
        `/roast-room ${command.decision}` +
        (command.mode === "quick"
          ? " --quick"
          : command.mode === "seats"
            ? ` --seats ${command.seats.join(",")}`
            : command.mode === "all"
              ? " --all"
              : "")
      );
    case "ask":
      return `/roast-room ask ${command.seat} ${command.question}`;
    case "board":
      return `/roast-room board${command.instruction ? " " + command.instruction : ""}`;
    case "newroaster":
      return (
        `/newroaster ${command.name}` +
        (command.depth === "quick"
          ? " --quick"
          : command.depth === "deep"
            ? " --deep"
            : "") +
        (command.pillar ? ` --pillar "${command.pillar}"` : "") +
        (command.makeDefault ? " --default" : "")
      );
    case "portrait":
      return `/newroaster portrait ${command.name}`;
    case "error":
      return null;
  }
}

export const askToolName = "mcp__amun_council__ask_owner";
/**
 * Verified 12 Nov 2026 with Claude Code 2.1.321: AskUserQuestion is not offered
 * in --print mode, so the Chair cannot use it headless. Amun therefore gives
 * the Chair an owner-question tool over MCP and routes it to the Island.
 */
export const chairBridgePrompt = [
  "You are running inside Amun without an interactive terminal.",
  `AskUserQuestion is unavailable here. Whenever the protocol says to ask the user, call ${askToolName} instead with the same questions and options, then continue with the answer it returns.`,
  "Ask only for information that is missing from the brief and the context you were given.",
  "Your verdict is advisory. Do not change any roadmap, backlog or ticket.",
].join(" ");

/** Arguments for the headless Chair run. Reuses the Mac's own Claude Code sign-in (Q10). */
export function chairInvocation(input: {
  command: CouncilCommand;
  mcpConfigPath: string;
  /** Group-permitted context only; assembled by the caller after the group filter. */
  context?: string;
}) {
  const prompt = upstreamCommand(input.command);
  if (!prompt) return null;
  return {
    args: [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--mcp-config",
      input.mcpConfigPath,
      // Only Amun's question tool; the Mac's other MCP servers stay out.
      "--strict-mcp-config",
      // The Chair reads brains, runs advisors and writes the session files.
      // No shell: nothing outside the composed runtime is executed.
      "--allowedTools",
      [askToolName, "Task", "Read", "Glob", "Grep", "Write", "Edit"].join(","),
      "--append-system-prompt",
      chairBridgePrompt,
    ],
    stdin:
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: input.context
            ? `${prompt}\n\nContext you may use:\n${input.context}`
            : prompt,
        },
      }) + "\n",
  };
}

export interface ChairQuestion {
  question: string;
  options: string[];
  multiSelect: boolean;
}
/** Normalises the tool input the Chair sends into Island questions. */
export function chairQuestions(input: unknown): ChairQuestion[] {
  const list =
    input && typeof input === "object" && "questions" in input
      ? (input as { questions: unknown }).questions
      : null;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry): ChairQuestion[] => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Record<string, unknown>;
    if (typeof raw.question !== "string" || !raw.question.trim()) return [];
    const options = Array.isArray(raw.options)
      ? raw.options.flatMap((option) =>
          typeof option === "string"
            ? [option]
            : option &&
                typeof option === "object" &&
                typeof (option as { label?: unknown }).label === "string"
              ? [(option as { label: string }).label]
              : [],
        )
      : [];
    return [
      {
        question: raw.question.trim().slice(0, 1024),
        options: options.slice(0, 8),
        multiSelect: raw.multiSelect === true,
      },
    ];
  });
}

// ── Roster composition (plan §3) ─────────────────────────────────────────────
export interface Seat {
  key: string;
  name: string;
  slug: string;
  color?: string;
  [extra: string]: unknown;
}
export type BoardMode = "ask" | "auto" | "default";
/** Upstream's roster.json: a board mode, the default board, and every seat. */
export interface Roster {
  seats: Seat[];
  board?: BoardMode;
  default?: string[];
  [extra: string]: unknown;
}
export interface Registry {
  advisors: Seat[];
  disabled: string[];
  /** The user's own board mode and default board, when they changed them. */
  board: { board?: BoardMode; default?: string[] } | null;
}
/** Upstream seats − disabled + registry advisors; board from the user's override. */
export function composeRoster(upstream: Roster, registry: Registry): Roster {
  const custom = new Map(registry.advisors.map((seat) => [seat.key, seat]));
  const seats = [
    ...upstream.seats.filter(
      (seat) => !registry.disabled.includes(seat.key) && !custom.has(seat.key),
    ),
    ...registry.advisors,
  ];
  const keys = new Set(seats.map((seat) => seat.key));
  const board = registry.board?.board ?? upstream.board;
  const chosen = registry.board?.default ?? upstream.default;
  return {
    ...upstream,
    ...(board ? { board } : {}),
    // A default board can only name seats that are actually present.
    ...(chosen ? { default: chosen.filter((key) => keys.has(key)) } : {}),
    seats,
  };
}
/** Every seat needs an agent file and a brain before a runtime may be used. */
export function validateRoster(
  roster: unknown,
  has: { agent(key: string): boolean; brain(slug: string): boolean },
): string[] {
  if (
    !roster ||
    typeof roster !== "object" ||
    !Array.isArray((roster as Roster).seats)
  )
    return ["The roster file has no list of seats."];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const seat of (roster as Roster).seats) {
    if (
      !seat ||
      typeof seat.key !== "string" ||
      typeof seat.slug !== "string"
    ) {
      problems.push("A seat is missing its key or brain name.");
      continue;
    }
    if (seen.has(seat.key))
      problems.push(`Seat "${seat.key}" is listed twice.`);
    seen.add(seat.key);
    if (!has.agent(seat.key))
      problems.push(`Seat "${seat.key}" has no agent file.`);
    if (!has.brain(seat.slug))
      problems.push(`Seat "${seat.key}" has no brain.`);
  }
  if (!(roster as Roster).seats.length)
    problems.push("The roster has no seats.");
  return problems;
}
/** Commands the skill front matter must still advertise after an update. */
export function missingCommands(skillText: string) {
  return ["--quick", "--seats", "--all", "ask", "board"].filter(
    (token) => !skillText.includes(token),
  );
}

// ── Update classification (plan §6) ──────────────────────────────────────────
export type RestartClass = "reload" | "restart";
export function classifyUpdate(input: {
  changedFiles: string[];
  requiredNode?: string | null;
  bundledNode: string;
}): { class: RestartClass; reasons: string[] } {
  const reasons: string[] = [];
  const major = (version: string) => Number(/\d+/.exec(version)?.[0] ?? 0);
  if (
    input.requiredNode &&
    major(input.requiredNode) > major(input.bundledNode)
  )
    reasons.push(
      `Needs Node ${input.requiredNode}; Amun ships ${input.bundledNode}.`,
    );
  // The session JSON contract Amun reads lives in references/live-room.md.
  if (
    input.changedFiles.some((file) => /references\/live-room\.md$/.test(file))
  )
    reasons.push("The session format Amun reads has changed.");
  return { class: reasons.length ? "restart" : "reload", reasons };
}
/** An executable change is noted in Activity; updates still apply automatically (Q45). */
export function executableChanges(changedFiles: string[]) {
  return changedFiles.filter((file) => /\.(mjs|js|cjs|py|sh)$/.test(file));
}

export interface CouncilManifest {
  repo: string | null;
  current: { commit: string; sha256: string; validatedAt: string } | null;
  previous: { commit: string; sha256: string; validatedAt: string } | null;
  lastCheckedAt: string | null;
}
export const emptyManifest: CouncilManifest = {
  repo: null,
  current: null,
  previous: null,
  lastCheckedAt: null,
};
/** A validated candidate becomes current; the old current is kept for rollback. */
export function promote(
  manifest: CouncilManifest,
  candidate: { commit: string; sha256: string },
  now: string,
): CouncilManifest {
  if (manifest.current?.commit === candidate.commit) return manifest;
  return {
    ...manifest,
    previous: manifest.current,
    current: { ...candidate, validatedAt: now },
  };
}
export function rollback(manifest: CouncilManifest): CouncilManifest | null {
  if (!manifest.previous) return null;
  return {
    ...manifest,
    current: manifest.previous,
    previous: manifest.current,
  };
}
const weekMs = 7 * 86_400_000;
export function updateDue(manifest: CouncilManifest, now: number) {
  return (
    !!manifest.repo &&
    (!manifest.lastCheckedAt ||
      now - Date.parse(manifest.lastCheckedAt) >= weekMs)
  );
}

// ── Theme mapping (plan §5) ──────────────────────────────────────────────────
export const themeMap: [string, string][] = [
  ["--canvas", "--amun-color-canvas"],
  ["--surface", "--amun-color-navigation"],
  ["--surface-2", "--amun-color-card"],
  ["--surface-3", "--amun-color-card"],
  ["--hairline", "--amun-color-structure"],
  ["--hairline-strong", "--amun-color-control-border"],
  ["--ink", "--amun-color-text"],
  ["--ink-soft", "--amun-color-supporting"],
  ["--ink-mute", "--amun-color-supporting"],
  ["--accent", "--amun-color-accent"],
  ["--accent-deep", "--amun-color-accent"],
  ["--accent-soft", "--amun-color-accent-soft"],
  ["--go", "--amun-safety-success"],
  ["--amend", "--amun-safety-warning"],
  ["--dissent", "--amun-safety-error"],
  ["--font-display", "--amun-font-ui"],
  ["--font-text", "--amun-font-ui"],
];
/**
 * Stylesheet injected into the room view after load. Returns the variables
 * that could not be resolved so validation can reject a broken mapping.
 */
export function roomThemeCss(tokens: Record<string, string>) {
  const missing: string[] = [];
  const lines = themeMap.flatMap(([room, amun]) => {
    const value = tokens[amun];
    if (!value) {
      missing.push(amun);
      return [];
    }
    return [`  ${room}: ${value};`];
  });
  return { css: `:root {\n${lines.join("\n")}\n}\n`, missing };
}
/** Reads one [data-theme] block of tokens.css into a name → value map. */
export function themeTokens(css: string, theme: string) {
  const block = new RegExp(
    `\\[data-theme="${theme.replace(/[^a-z0-9-]/gi, "")}"\\]\\s*\\{([^}]*)\\}`,
  ).exec(css);
  const tokens: Record<string, string> = {};
  for (const match of (block?.[1] ?? "").matchAll(
    /(--[a-z0-9-]+):\s*([^;]+);/g,
  ))
    tokens[match[1]!] = match[2]!.trim();
  return tokens;
}

// ── Sessions and verdicts (Q62) ──────────────────────────────────────────────
export interface CouncilSession {
  id: string;
  decision: string;
  groupId: string | null;
  /** Null = intentionally unlinked within its group. */
  workAreaId: string | null;
  mode: string;
  state: "running" | "waiting_on_you" | "finished" | "failed";
  recommendation: string | null;
  createdAt: string;
}
export const simulationLabel =
  "Advisors are simulations built from sourced public material. They are not the people themselves.";
/**
 * A verdict is advisory: the report goes to the Library and an actionable
 * recommendation goes to Decisions for review. Nothing else changes.
 */
export function verdictOutputs(session: CouncilSession) {
  if (session.state !== "finished") return { library: null, decision: null };
  return {
    library: {
      type: "council_report",
      title: `Council · ${session.decision}`,
      groupId: session.groupId,
      workAreaIds: session.workAreaId ? [session.workAreaId] : [],
    },
    decision: session.recommendation
      ? {
          what: session.decision,
          options: [session.recommendation],
          source: "council" as const,
          outcome: null,
          groupId: session.groupId,
          workAreaId: session.workAreaId,
        }
      : null,
    changesRoadmapOrTickets: false as const,
  };
}
/** Firstmate suggests a full council for costly or irreversible decisions (Q46). */
export function suggestFullCouncil(decision: string) {
  return /\b(irreversible|cannot be undone|can't be undone|acquire|acquisition|lay ?off|shut ?down|sunset|multi-year|contract|pricing|re-?platform|hire|fire)\b/i.test(
    decision,
  );
}
