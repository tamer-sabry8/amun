import {
  attentionItem,
  type AttentionItem,
  type StatusActivity,
} from "../../contracts/src/entities.ts";
function priority(item: AttentionItem, running: ReadonlySet<string>): number {
  if (item.type === "unblock") return 0;
  if (
    (item.type === "answer" || item.type === "decide") &&
    item.blocking.some((ref) => running.has(ref))
  )
    return 1;
  if (item.type === "approve") return 2;
  if (item.type === "reconnect" || item.type === "resolve_conflict") return 3;
  if (
    item.type === "review" ||
    item.type === "answer" ||
    item.type === "decide"
  )
    return 4;
  if (item.type === "apply" || item.type === "create") return 5;
  return 6;
}
export function attentionQueue(
  items: readonly AttentionItem[],
  productId: string | null,
  now: number,
  running: ReadonlySet<string> = new Set(),
): AttentionItem[] {
  if (!Number.isFinite(now)) throw Error("Invalid attention query time");
  return items
    .map((item) => attentionItem.parse(item))
    .filter(
      (item) =>
        (productId === null || item.productId === productId) &&
        item.state !== "resolved" &&
        (item.state === "open" || Date.parse(item.snoozedUntil!) <= now),
    )
    .map((item) =>
      item.state === "snoozed"
        ? { ...item, state: "open" as const, snoozedUntil: null }
        : item,
    )
    .sort(
      (a, b) =>
        priority(a, running) - priority(b, running) ||
        Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
}
export function resolveAttention(
  input: AttentionItem,
  source: "island" | "review",
  answer?: string,
): AttentionItem {
  const item = attentionItem.parse(input);
  if (item.state !== "open" || item.governed || item.type === "approve")
    throw Error("Request requires its governed review flow");
  if (item.type === "answer" && (!answer?.trim() || answer.length > 16384))
    throw Error("An explicit answer is required");
  if (source !== "island" && source !== "review")
    throw Error("Invalid resolution source");
  if (
    source === "island" &&
    (item.type !== "answer" ||
      item.primaryAction.mode !== "inline" ||
      !answer?.trim() ||
      answer.length > 16384)
  )
    throw Error("Only explicit non-governed inline answers may resolve here");
  return { ...item, state: "resolved", snoozedUntil: null };
}
export function snoozeAttention(
  input: AttentionItem,
  until: number,
  now: number,
): AttentionItem {
  const item = attentionItem.parse(input);
  if (
    item.state === "resolved" ||
    !Number.isFinite(now) ||
    !Number.isFinite(until) ||
    until <= now ||
    until - now > 365 * 24 * 60 * 60 * 1000
  )
    throw Error("Invalid snooze");
  return {
    ...item,
    state: "snoozed",
    snoozedUntil: new Date(until).toISOString(),
  };
}
export function activitySummary(
  items: readonly Pick<StatusActivity, "kind" | "state">[],
) {
  let working = 0,
    publishing = 0,
    waiting = 0,
    failed = 0;
  for (const item of items) {
    if (
      ![
        "run",
        "publication",
        "story_preparation",
        "sync",
        "reconciliation",
        "runtime_health",
        "action",
      ].includes(item.kind) ||
      !["working", "waiting", "failed", "completed"].includes(item.state)
    )
      throw Error("Invalid activity");
    if (item.state === "working") {
      if (item.kind === "publication") publishing++;
      else working++;
    } else if (item.state === "waiting") waiting++;
    else if (item.state === "failed") failed++;
  }
  const tone = failed
    ? "failed"
    : waiting
      ? "waiting"
      : working + publishing
        ? "working"
        : "idle";
  return { working, publishing, waiting, failed, tone };
}
