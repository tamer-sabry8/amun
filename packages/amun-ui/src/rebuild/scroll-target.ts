export type ScrollTarget = "latest-reply" | "end" | "none";

type Line = { role: string };

/**
 * Where the conversation should scroll after it changes.
 * `prevCount` is null the first time a conversation is shown.
 * A new Firstmate reply is shown from its start, because the cards below it
 * can push it out of view; otherwise the bottom is kept, which holds the
 * owner's message and the working indicator.
 */
export function scrollTarget(
  prevCount: number | null,
  messages: readonly Line[],
  busy: boolean,
): ScrollTarget {
  const fresh = messages.slice(prevCount ?? Math.max(0, messages.length - 1));
  if (fresh.some((message) => message.role === "firstmate"))
    return "latest-reply";
  if (prevCount === null) return "end";
  if (messages.length > prevCount || busy) return "end";
  return "none";
}

/**
 * Index of the first Firstmate message or card of its latest turn: the first
 * one after the owner's most recent message, or, with no owner message, the
 * start of the trailing run of Firstmate/card messages. -1 when there is none.
 */
export function latestTurnStart(messages: readonly Line[]): number {
  const isReply = (message: Line) =>
    message.role === "firstmate" || message.role === "card";
  const owner = messages.findLastIndex((message) => message.role === "you");
  if (owner >= 0) {
    const next = messages.findIndex(
      (message, index) => index > owner && isReply(message),
    );
    return next;
  }
  let start = messages.length;
  while (start > 0 && isReply(messages[start - 1]!)) start--;
  return start < messages.length ? start : -1;
}
