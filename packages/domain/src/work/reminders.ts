/** Reminders: plain-language requests to be reminded, listed or cancelled. */

export type ReminderIntent = "add" | "list" | "cancel";

const POLITE = String.raw`(?:(?:please|pls|can you|could you|would you|will you|kindly|hey|hi|ok(?:ay)?|and|then)[\s,]+)*`;
const ADD = new RegExp(
  String.raw`^\s*${POLITE}(?:(?:remind\s+me\b)|(?:set\s+(?:up\s+)?(?:an?\s+|another\s+)?(?:\w+\s+)?reminder\b)|(?:(?:create|add|make|schedule)\s+(?:me\s+)?(?:an?\s+)?reminder\b)|(?:reminder\s*:))`,
  "i",
);
const CANCEL = new RegExp(
  String.raw`^\s*${POLITE}(?:cancel|delete|remove|clear|forget|drop)\b.*\breminders?\b`,
  "i",
);
const LIST = new RegExp(
  String.raw`^\s*${POLITE}(?:(?:list|show|what|which|do i have|any)\b.*\breminders?\b|(?:my\s+)?reminders?\s*\??\s*$)`,
  "i",
);

export function reminderIntent(text: string): ReminderIntent | null {
  if (ADD.test(text)) return "add";
  if (CANCEL.test(text)) return "cancel";
  if (LIST.test(text)) return "list";
  return null;
}

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};
const WORD_NUMBER: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  sixty: 60,
};
const NUM = String.raw`(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|sixty)`;
const IN_DURATION = new RegExp(
  String.raw`\bin\s+(?:(half)\s+an?\s+(hour|day)|${NUM}\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?))\b`,
  "i",
);
const CLOCK = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?`;
const AT_TIME = new RegExp(String.raw`\bat\s+${CLOCK}(?![\d:])`, "i");
const TOMORROW = /\btomorrow\b/i;
const DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const WEEKDAY = new RegExp(String.raw`\b(?:on\s+)?(${DAYS.join("|")})\b`, "i");

export type ParsedReminder =
  { ok: true; dueAt: Date; what: string } | { ok: false; message: string };

const WHEN_HELP =
  "Tell me when, for example “in 2 minutes”, “at 3pm” or “tomorrow at 9am”.";

function clock(match: RegExpMatchArray): { h: number; m: number } | null {
  let h = Number(match[1]);
  const m = match[2] ? Number(match[2]) : 0;
  const meridian = match[3]?.toLowerCase().replace(/\./g, "");
  if (m > 59) return null;
  if (meridian) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (meridian === "pm" ? 12 : 0);
  } else if (h > 23 || (!match[2] && h > 12)) return null;
  return { h, m };
}

/** Finds when and what in "remind me in 2 minutes to review the QA PRD". */
export function parseReminder(text: string, now: Date): ParsedReminder {
  let rest = text.replace(ADD, " ").replace(/^[\s:,-]+/, "");
  let dueAt: Date | null = null;
  const duration = rest.match(IN_DURATION);
  if (duration) {
    const unit = duration[2] ?? duration[4]!;
    const amount = duration[1]
      ? 0.5
      : /^\d/.test(duration[3]!)
        ? Number(duration[3])
        : WORD_NUMBER[duration[3]!.toLowerCase()]!;
    const ms = UNIT_MS[unit.toLowerCase()[0]!]! * amount;
    if (!(ms >= 1000)) return { ok: false, message: WHEN_HELP };
    dueAt = new Date(now.getTime() + ms);
    rest = rest.replace(IN_DURATION, " ");
  } else {
    const tomorrow = TOMORROW.test(rest);
    const weekday = tomorrow ? null : rest.match(WEEKDAY);
    const at = rest.match(AT_TIME);
    const time = at ? clock(at) : null;
    if (at && !time) return { ok: false, message: WHEN_HELP };
    if (tomorrow || weekday || time) {
      dueAt = new Date(now);
      dueAt.setSeconds(0, 0);
      dueAt.setHours(time?.h ?? 9, time?.m ?? 0);
      if (tomorrow) dueAt.setDate(dueAt.getDate() + 1);
      else if (weekday) {
        const ahead =
          (DAYS.indexOf(weekday[1]!.toLowerCase()) - now.getDay() + 7) % 7;
        dueAt.setDate(dueAt.getDate() + ahead);
        if (dueAt <= now) dueAt.setDate(dueAt.getDate() + 7);
      } else if (dueAt <= now) dueAt.setDate(dueAt.getDate() + 1);
      rest = rest
        .replace(TOMORROW, " ")
        .replace(WEEKDAY, weekday ? " " : "$&")
        .replace(AT_TIME, " ");
    }
  }
  if (!dueAt) return { ok: false, message: WHEN_HELP };
  const what = rest
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:me\s+)?(?:to|that|about)\s+/i, "")
    .replace(/\s+(?:to|that|about)$/i, "")
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "")
    .slice(0, 200);
  if (!what)
    return {
      ok: false,
      message: "What should I remind you about? Add it after the time.",
    };
  return { ok: true, dueAt, what };
}

export function reminderTime(iso: string, now: Date): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  if (at.toDateString() === now.toDateString()) return time;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (at.toDateString() === tomorrow.toDateString()) return "tomorrow " + time;
  return (
    at.toLocaleDateString([], { month: "short", day: "numeric" }) + ", " + time
  );
}

/** "at 3:05 PM", "tomorrow at 9:00 AM" or "on Nov 20 at 10:30 AM". */
export function reminderWhen(at: Date, now: Date): string {
  const time = at.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  if (at.toDateString() === now.toDateString()) return "at " + time;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (at.toDateString() === tomorrow.toDateString())
    return "tomorrow at " + time;
  return (
    "on " +
    at.toLocaleDateString([], { month: "short", day: "numeric" }) +
    " at " +
    time
  );
}

/** Which open reminders a "cancel …" request names; empty when it names none. */
export function reminderMatches<T extends { text: string }>(
  request: string,
  open: readonly T[],
): T[] {
  if (/\b(?:all|every|everything)\b/i.test(request)) return [...open];
  const words = request
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(
      (word) =>
        word.length > 2 &&
        ![
          "cancel",
          "delete",
          "remove",
          "clear",
          "forget",
          "drop",
          "reminder",
          "reminders",
          "the",
          "please",
          "about",
          "for",
          "that",
          "can",
          "you",
          "could",
          "would",
          "will",
          "kindly",
          "my",
        ].includes(word),
    );
  if (!words.length) return [];
  return open.filter((item) => {
    const text = item.text.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
