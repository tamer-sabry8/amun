// "What happened": a read-only account of the First Mate's turns, built from
// the timeline Paseo already keeps for it. Nothing here starts, steers or
// re-runs anything; it only reads.

/** The parts of a Paseo timeline row this reads. */
export interface TimelineRowLike {
  seq: number;
  timestamp: string;
  turnId?: string;
  item: { type: string };
}

/** A conversation message from Amun's own store. */
export interface MessageLike {
  id: string;
  workAreaId: string;
  role: string;
  text: string;
  createdAt: string;
}

export interface HappenedStep {
  id: string;
  kind: "action" | "answer" | "problem";
  /** What the First Mate did, in plain words. */
  words: string;
  /** The Firstmate script or tool behind it, when there is one. */
  script: string | null;
  at: string;
  /** Until the next step began; null for the last step of the newest turn. */
  durationMs: number | null;
  sent: string;
  cameBack: string;
  failed: boolean;
}

export interface HappenedTurn {
  id: string;
  /** "you": a message the captain sent. "woke": anything else that woke it. */
  trigger: "you" | "woke";
  /** What the captain typed, or the words that woke the First Mate. */
  prompt: string;
  at: string;
  durationMs: number | null;
  workAreaId: string | null;
  steps: HappenedStep[];
}

const LIMIT = 8000;
const clip = (text: string, limit = LIMIT) =>
  text.length > limit ? text.slice(0, limit) + "…" : text;
const text = (value: unknown): string =>
  typeof value === "string" ? value : value == null ? "" : JSON.stringify(value, null, 2);
const quote = (value: string, limit = 60) => {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > limit ? line.slice(0, limit).trimEnd() + "…" : line;
};

/** Firstmate's own scripts, in the words the captain reads. Longest names first. */
const SCRIPTS: [RegExp, string][] = [
  [/fm-fleet-snapshot/, "read who is working"],
  [/fm-spawn\S*\s[^|;&]*--secondmate/, "started a secondmate in its own worktree"],
  [/fm-spawn/, "started a crewmate in its own worktree"],
  [/fm-home-seed/, "prepared a secondmate's home"],
  [/fm-brief/, "wrote a brief for the crew"],
  [/fm-peek/, "read a crewmate's work"],
  [/fm-send/, "sent a message to a crewmate"],
  [/fm-teardown/, "retired a crewmate"],
  [/fm-captain-hold\S*\s+answer/, "recorded your answer"],
  [/fm-captain-hold/, "kept a question for you"],
  [/tasks-axi/, "worked on the backlog"],
  [/fm-[a-z0-9-]+/, "ran a Firstmate script"],
];

function scriptName(command: string): string | null {
  const found = /(?:^|[\s/])((?:fm-[a-z0-9-]+|(?:amun-)?tasks-axi)(?:\.sh)?)((?:\s+--?[a-z][a-z-]*)?)/.exec(
    command,
  );
  if (!found) return null;
  const name = found[1]!.replace(/\.sh$/, "");
  const flag = found[2]!.trim();
  return flag === "--secondmate" ? `${name} ${flag}` : name;
}

type Item = { type: string; [key: string]: unknown };

function describeTool(item: Item): Pick<HappenedStep, "words" | "script" | "sent" | "cameBack"> {
  const detail = (item.detail ?? {}) as { type?: string; [key: string]: unknown };
  const name = text(item.name);
  const file = (path: unknown) => text(path).split("/").pop() ?? "";
  switch (detail.type) {
    case "shell": {
      const command = text(detail.command);
      const script = scriptName(command);
      const words = script
        ? (SCRIPTS.find(([pattern]) => pattern.test(command))?.[1] ?? "ran a Firstmate script")
        : "ran a command";
      return { words, script, sent: command, cameBack: text(detail.output) };
    }
    case "read":
      return {
        words: `read ${file(detail.filePath) || "a file"}`,
        script: null,
        sent: text(detail.filePath),
        cameBack: text(detail.content),
      };
    case "edit":
    case "write":
      return {
        words: `changed ${file(detail.filePath) || "a file"}`,
        script: null,
        sent: text(detail.filePath),
        cameBack: "",
      };
    case "search":
      return { words: "searched its files", script: null, sent: text(detail.query), cameBack: "" };
    case "fetch":
      return { words: "opened a web page", script: null, sent: text(detail.url), cameBack: text(detail.result) };
    default: {
      const input = "input" in detail ? detail.input : undefined;
      const output = "output" in detail ? detail.output : (detail.text ?? "");
      return {
        words: /heartbeat|schedule/i.test(name) ? "set or checked a timed reminder" : `used ${name || "a tool"}`,
        script: name || null,
        sent: text(input),
        cameBack: text(output),
      };
    }
  }
}

const ms = (from: string, to: string): number | null => {
  const span = Date.parse(to) - Date.parse(from);
  return Number.isFinite(span) && span >= 0 ? span : null;
};

/** Groups timeline rows into turns, each with its steps in order. */
export function turnsFromTimeline(rows: TimelineRowLike[]): HappenedTurn[] {
  const turns: HappenedTurn[] = [];
  let current: HappenedTurn | null = null;
  let turnKey: string | undefined;
  const open = (row: TimelineRowLike, prompt: string) => {
    current = {
      id: `t${row.seq}`,
      trigger: "woke",
      prompt,
      at: row.timestamp,
      durationMs: null,
      workAreaId: null,
      steps: [],
    };
    turnKey = row.turnId;
    turns.push(current);
    return current;
  };
  for (const row of [...rows].sort((a, b) => a.seq - b.seq)) {
    const item = row.item as Item;
    if (item.type === "user_message") {
      open(row, text(item.text));
      continue;
    }
    if (item.type !== "assistant_message" && item.type !== "tool_call" && item.type !== "error") continue;
    let turn: HappenedTurn | null = current;
    if (!turn || (row.turnId && turnKey && row.turnId !== turnKey)) turn = open(row, "");
    if (!turnKey) turnKey = row.turnId;
    const last = turn.steps.at(-1);
    if (item.type === "assistant_message") {
      const said = text(item.text);
      // A reply arrives in pieces; they are one answer.
      if (last?.kind === "answer") {
        last.cameBack = clip(last.cameBack + said);
        last.words = `answered: “${quote(last.cameBack)}”`;
        continue;
      }
      if (!said.trim()) continue;
      turn.steps.push({
        id: `s${row.seq}`,
        kind: "answer",
        words: `answered: “${quote(said)}”`,
        script: null,
        at: row.timestamp,
        durationMs: null,
        sent: "",
        cameBack: clip(said),
        failed: false,
      });
      continue;
    }
    if (item.type === "error") {
      turn.steps.push({
        id: `s${row.seq}`,
        kind: "problem",
        words: "ran into a problem",
        script: null,
        at: row.timestamp,
        durationMs: null,
        sent: "",
        cameBack: clip(text(item.message)),
        failed: true,
      });
      continue;
    }
    const described = describeTool(item);
    turn.steps.push({
      id: `s${row.seq}`,
      kind: "action",
      ...described,
      sent: clip(described.sent),
      cameBack: clip(described.cameBack || (item.status === "failed" ? text(item.error) : "")),
      at: row.timestamp,
      durationMs: null,
      failed: item.status === "failed",
    });
  }
  // A step lasts until the next one begins; a turn until the next turn.
  turns.forEach((turn, index) => {
    const next = turns[index + 1];
    turn.steps.forEach((step, at) => {
      const after = turn.steps[at + 1]?.at ?? next?.at;
      step.durationMs = after ? ms(step.at, after) : null;
    });
    const end = turn.steps.at(-1)?.at;
    turn.durationMs = end ? ms(turn.at, end) : null;
  });
  return turns.filter((turn) => turn.prompt.trim() || turn.steps.length);
}

const WINDOW = 10 * 60_000;
const near = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= WINDOW;
const head = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 80);

/**
 * Says which conversation each turn belongs to. The First Mate has one
 * timeline for every conversation, and no work area id travels with a
 * message, so a turn is matched by the captain's own words inside its prompt,
 * or by the reply Amun saved from it, within ten minutes.
 */
export function placeTurns(turns: HappenedTurn[], messages: MessageLike[]): HappenedTurn[] {
  const yours = messages.filter((message) => message.role === "you" && message.text.trim());
  const replies = messages.filter((message) => message.role === "firstmate" && message.text.trim());
  return turns.map((turn) => {
    const asked = yours
      .filter((message) => near(message.createdAt, turn.at) && turn.prompt.includes(message.text.trim()))
      .sort(
        (a, b) =>
          b.text.length - a.text.length ||
          Math.abs(Date.parse(a.createdAt) - Date.parse(turn.at)) -
            Math.abs(Date.parse(b.createdAt) - Date.parse(turn.at)),
      )[0];
    if (asked) return { ...turn, trigger: "you" as const, prompt: asked.text, workAreaId: asked.workAreaId };
    const answer = turn.steps.findLast((step) => step.kind === "answer");
    const end = answer?.at ?? turn.at;
    const saved = answer
      ? replies.find(
          (message) =>
            (near(message.createdAt, end) || near(message.createdAt, turn.at)) &&
            head(message.text) === head(answer.cameBack),
        )
      : undefined;
    return saved ? { ...turn, workAreaId: saved.workAreaId } : turn;
  });
}

export interface StepHit {
  turnId: string;
  stepId: string;
  workAreaId: string;
  words: string;
  script: string | null;
  at: string;
}

/** Steps whose words, script, input or result hold every word of the query. */
export function searchSteps(turns: HappenedTurn[], query: string, limit = 6): StepHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: StepHit[] = [];
  for (const turn of [...turns].reverse()) {
    if (!turn.workAreaId) continue;
    for (const step of turn.steps) {
      if (step.kind !== "action") continue;
      const hay = `${step.words} ${step.script ?? ""} ${step.sent} ${step.cameBack}`.toLowerCase();
      if (!words.every((word) => hay.includes(word))) continue;
      hits.push({
        turnId: turn.id,
        stepId: step.id,
        workAreaId: turn.workAreaId,
        words: step.words,
        script: step.script,
        at: step.at,
      });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}
