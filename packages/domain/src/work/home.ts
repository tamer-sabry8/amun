// Home, attention rows, ranking, failures and status (handoff §5–§8a).

export type AttentionKind =
  "approval" | "question" | "risk" | "failure" | "result" | "offer" | "linking";
export interface Attention {
  id: string;
  kind: AttentionKind;
  groupName: string | null;
  workAreaId: string | null;
  workAreaName: string | null;
  title: string;
  detail: string;
  state: "open" | "done" | "snoozed";
  createdAt: string;
  /** Present when the row carries a batch that can be approved in the tray. */
  batch?: { count: number; noun: string; summary: string; items: string[] };
}

const kindLabels: Record<AttentionKind, string> = {
  approval: "Approval",
  question: "Question",
  risk: "Risk",
  failure: "Failure",
  result: "Result",
  offer: "Follow-up offer",
  linking: "Linking",
};
// One word, one consequence: "Review" opens a review and never executes.
const primaryLabels: Partial<Record<AttentionKind, string>> = {
  approval: "Review changes",
  offer: "Yes, draft it",
  result: "View findings",
  failure: "See what happened",
  risk: "Review impact",
};

export interface AttentionRow {
  id: string;
  label: string;
  title: string;
  detail: string;
  /** At most one primary button; rows that only need conversation have none. */
  primary: string | null;
  overflow: string[];
  /** Row click always opens the conversation. It never approves or executes. */
  rowAction: "open_conversation";
  tray: boolean;
}
export function attentionRow(item: Attention): AttentionRow {
  const context = [item.groupName, item.workAreaName]
    .filter(Boolean)
    .join(" / ");
  return {
    id: item.id,
    label: [kindLabels[item.kind], context].filter(Boolean).join(" · "),
    title: item.title,
    detail: item.detail,
    primary: primaryLabels[item.kind] ?? null,
    overflow: [
      ...(item.workAreaId ? ["Open project"] : []),
      // An outside change can be acknowledged; it is never reverted (Q75).
      ...(item.kind === "risk" ? ["Acknowledge"] : []),
      "Snooze attention item",
    ],
    rowAction: "open_conversation",
    tray: item.kind === "approval" && !!item.batch,
  };
}

/** What a proposal has not done yet, named for where it would go. */
export function previewNote(destination: string) {
  return destination === "ado"
    ? "Preview only · No Azure DevOps changes"
    : "Preview only · Nothing changes until you approve";
}
/** Labels that make clear what an accepted offer or a result did not do (Q50). */
export const outcomeNotes = {
  draft: "Draft only · Nothing sent · Approval status unchanged",
  research: "Research output · No roadmap or backlog changes",
  preview: "Preview only · No Azure DevOps changes",
} as const;

const urgency: Record<AttentionKind, number> = {
  failure: 0,
  approval: 1,
  question: 2,
  risk: 3,
  offer: 4,
  result: 5,
  linking: 6,
};
export function attentionList(
  items: Attention[],
  filter: "open" | "done" | AttentionKind = "open",
) {
  return items
    .filter((item) =>
      filter === "open"
        ? item.state === "open"
        : filter === "done"
          ? item.state === "done"
          : item.state === "open" && item.kind === filter,
    )
    .sort(
      (a, b) =>
        urgency[a.kind] - urgency[b.kind] ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
}
/** The Island shows the single most urgent open item plus a count badge. */
/**
 * What Firstmate's card in the sidebar shows. Things raised in the work whose
 * chat is open are left out: the chat is already asking, so repeating it
 * beside the chat is noise. `held` counts what was left out, so the card can
 * stay away instead of claiming nothing needs the owner.
 */
export function islandItem(items: Attention[], openWorkAreaId?: string | null) {
  const open = attentionList(items);
  const shown = openWorkAreaId
    ? open.filter((item) => item.workAreaId !== openWorkAreaId)
    : open;
  return {
    top: shown[0] ?? null,
    count: shown.length,
    held: open.length - shown.length,
  };
}

const plural = (count: number, noun: string) =>
  `${count} ${count === 1 ? noun : noun + "s"}`;
/** "While you were away: 3 results, 1 question, 1 failure" (Q72). Null when nothing new. */
export function awaySummary(items: Attention[], lastSeen: string | null) {
  if (!lastSeen) return null;
  const fresh = items.filter(
    (item) => item.state === "open" && item.createdAt > lastSeen,
  );
  const count = (kind: AttentionKind) =>
    fresh.filter((item) => item.kind === kind).length;
  const parts = (
    [
      ["result", "result"],
      ["approval", "approval"],
      ["question", "question"],
      ["risk", "risk"],
      ["failure", "failure"],
    ] as const
  )
    .map(([kind, noun]) => [kind, count(kind), noun] as const)
    .filter(([, value]) => value > 0);
  if (!parts.length) return null;
  return {
    text:
      "While you were away: " +
      parts.map(([, value, noun]) => plural(value, noun)).join(", "),
    kinds: parts.map(([kind]) => kind),
  };
}

// ── Your work ranking (UC18) ─────────────────────────────────────────────────
export type Effort = "XS" | "S" | "M" | "L";
/** Rough working days per size: XS a few hours, S a day, M a few days, L one to two weeks. */
export const effortDays: Record<Effort, number> = {
  XS: 0.4,
  S: 1,
  M: 4,
  L: 10,
};
export interface WorkSignal {
  id: string;
  /** 0–3: how much the requester matters (boss, CEO…). */
  stakeholder: number;
  /** 0–3: how much the client matters. */
  client: number;
  dueAt: string | null;
  effort: Effort | null;
  lastContextAt: string | null;
  /** Learned interest: times the user asked about it while it was not shown. */
  interest: number;
  attention: number;
  done: boolean;
}
// [Open] decision 3: weights and thresholds are placeholders pending owner tuning.
export const rankingDefaults = {
  staleDays: 10,
  weights: {
    stakeholder: 3,
    client: 2,
    deadline: 4,
    stale: 1.5,
    interest: 1,
    attention: 2,
  },
};
const dayMs = 86_400_000;
export function rankWork(
  signals: WorkSignal[],
  now: number,
  options = rankingDefaults,
) {
  const w = options.weights;
  return signals
    .filter((signal) => !signal.done)
    .map((signal) => {
      const daysLeft =
        signal.dueAt === null ? null : (Date.parse(signal.dueAt) - now) / dayMs;
      const needed = signal.effort ? effortDays[signal.effort] : 1;
      // Pressure rises as the remaining time approaches the effort still needed,
      // so a large job due in three weeks can outrank a small one due sooner.
      const pressure =
        daysLeft === null
          ? 0
          : daysLeft <= 0
            ? 1
            : Math.min(1, needed / Math.max(daysLeft, needed));
      const staleFor =
        signal.lastContextAt === null
          ? options.staleDays
          : (now - Date.parse(signal.lastContextAt)) / dayMs;
      const stale = staleFor >= options.staleDays;
      const score =
        signal.stakeholder * w.stakeholder +
        signal.client * w.client +
        pressure * 3 * w.deadline +
        (stale ? w.stale : 0) +
        Math.min(signal.interest, 3) * w.interest +
        Math.min(signal.attention, 3) * w.attention;
      return {
        id: signal.id,
        score,
        // Staleness is missing context, never proof that nothing happened.
        note: stale
          ? `No update for ${Math.floor(staleFor)} days · context may be out of date`
          : null,
      };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

// ── Connection status (Q11–Q12) ──────────────────────────────────────────────
export type ConnectionState =
  "checking" | "signed_in" | "connected" | "signed_out" | "not_working";
export function connectionStatus(input: {
  state: ConnectionState;
  reason?: "out_of_credits" | "service_down" | "model_not_enabled" | null;
}) {
  const reasons = {
    out_of_credits: ["Out of credits", "Add credits"],
    service_down: ["Service down", "Try again"],
    model_not_enabled: ["Model not enabled", "Choose another model"],
  } as const;
  if (input.state === "checking")
    return {
      icon: "checking",
      tone: "checking",
      text: "Checking…",
      action: null,
    };
  // Signed in and accepted, but no model has answered yet. Kept apart from
  // "Connected", which is only claimed after a real reply.
  if (input.state === "signed_in")
    return {
      icon: "check",
      tone: "connected",
      text: "Signed in",
      action: null,
    };
  if (input.state === "connected")
    return {
      icon: "check",
      tone: "connected",
      text: "Connected",
      action: null,
    };
  if (input.state === "signed_out")
    return {
      icon: "warning",
      tone: "signed-out",
      text: "Signed out",
      action: "Sign in",
    };
  const [text, action] = reasons[input.reason ?? "service_down"];
  return {
    icon: "close",
    tone: "error",
    text: `Not working · ${text}`,
    action,
  };
}
/** Auto-test after sign-in and on app open, at most once a day. No Check buttons. */
export function shouldAutoTest(
  lastTestedAt: string | null,
  now: number,
  trigger: "open" | "sign_in",
) {
  if (trigger === "sign_in" || !lastTestedAt) return true;
  return now - Date.parse(lastTestedAt) >= dayMs;
}
/**
 * Maps the sign-in service's states onto the four shown to people.
 * A failed test only means "Not working" when this account has worked before
 * or was just signed in; otherwise there is simply no sign-in yet.
 */
export function fromLegacyStatus(
  status: string | undefined,
  history: {
    everReady?: boolean;
    attempted?: boolean;
    /** The stored sign-in has passed its one check since it was made. */
    checked?: boolean;
  } = {},
): ConnectionState {
  const value = (status ?? "missing").toLowerCase();
  if (value === "configured" && history.checked) return "signed_in";
  if (value === "checking" || value === "configured") return "checking";
  if (value === "ready" || value === "connected") return "connected";
  if (value === "error" || value === "failed")
    return history.everReady || history.attempted
      ? "not_working"
      : "signed_out";
  return "signed_out";
}

// ── Stakeholder update (Q73) ─────────────────────────────────────────────────
export function updateMessage(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return {
    words,
    ok: words >= 50 && words <= 90,
    hint:
      words < 50
        ? "A little short for an update"
        : words > 90
          ? "Longer than a 20-second read"
          : null,
    actions: ["Copy message", "Copy image"] as const,
    edits: ["Shorter", "More formal"] as const,
    note: "Saved to Library · Amun never sends it",
  };
}

// ── Failures (UC21, Q71) ─────────────────────────────────────────────────────
// [Open] decision 3: retry budget is a placeholder pending owner tuning.
export const retryBudget = 3;
export function failureSurface(input: {
  activeWorkAreaId: string | null;
  workAreaId: string | null;
}) {
  return input.workAreaId !== null &&
    input.workAreaId === input.activeWorkAreaId
    ? ("banner" as const)
    : ("island" as const);
}
export function nextRetry(input: {
  attempts: number;
  /** An external write may have completed: reconcile before replaying. */
  uncertainWrite: boolean;
  budget?: number;
}) {
  if (input.uncertainWrite) return "reconcile" as const;
  return input.attempts < (input.budget ?? retryBudget)
    ? ("retry" as const)
    : ("surface" as const);
}
export const failureOverflow = [
  "View diagnostics",
  "Copy log for a coding agent",
] as const;
