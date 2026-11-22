// Firstmate's own reminders ("captain holds") as they are shown on Home
// (owner, 20 November 2026). A hold filed under a project ("MoCA: …") is a
// task of that project with a tick box; any other is a reminder. Every
// choice is a request to Firstmate, which owns the hold; Amun closes nothing.
import { sameWorkName } from "./model.ts";

/** Attention ids for Firstmate's holds start with this. */
export const heldPrefix = "hold:";
export const isHeld = (id: string) => id.startsWith(heldPrefix);

/**
 * The project or product a hold belongs to, read from its title ("MoCA: …",
 * "MoCA - …"): a work whose name is the same, or starts with that word.
 */
export function heldProject(
  title: string,
  areas: readonly { name: string; type: string; status: string }[],
): string | null {
  const lead = /^\s*([^:–-]{2,60}?)\s*(?::|\s[–-]\s)/.exec(title)?.[1]?.trim();
  if (!lead) return null;
  const word = (name: string) => name.trim().split(/\s+/)[0] ?? "";
  const match = areas.find(
    (area) =>
      area.status !== "deleted" &&
      (area.type === "project" || area.type === "product") &&
      (sameWorkName(area.name, lead) || sameWorkName(word(area.name), lead)),
  );
  return match ? lead : null;
}

/** How long a ticked task stays in the open list before it goes to Done. */
export const tickedVisibleMs = 20_000;
/** How long Undo is offered before the request goes to Firstmate. */
export const tickUndoMs = 5_000;

/** "Remind me later": the days offered, as YYYY-MM-DD on the owner's calendar. */
export function laterDays(now: Date): { label: string; day: string }[] {
  const day = (date: Date) => {
    const two = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  };
  const plus = (days: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  // Next Monday is never today: from a Monday it is a week on.
  const toMonday = (8 - now.getDay()) % 7 || 7;
  return [
    { label: "Tomorrow morning", day: day(plus(1)) },
    { label: "Next Monday", day: day(plus(toMonday)) },
    { label: "In two weeks", day: day(plus(14)) },
  ];
}

/** What the owner sees in Done for a hold they closed or put off. */
export function heldOutcome(
  resolution: "done" | "snooze",
  until?: string,
): string {
  return resolution === "done"
    ? "Completed"
    : `Remind me on ${until ?? "a later day"}`;
}

/**
 * What Firstmate is told, as the owner's answer to its hold. Firstmate
 * decides how to record it with its own scripts.
 */
export function heldInstruction(
  resolution: "done" | "snooze",
  until?: string,
): string {
  return resolution === "done"
    ? "Completed. The captain says this is done and no longer needed. Record that and close the task; do not ask about it again."
    : `Not now. Remind the captain on ${until}. Keep it held and put it off until that day (bin/fm-captain-hold.sh hold with --until ${until}); do not raise it again before then.`;
}

/**
 * "Help me do it": the request sent to Firstmate in the owner's latest chat.
 * The owner's standing wish (20 November 2026): a reminder to write
 * something comes with a draft, or with questions when context is missing.
 */
export function helpRequest(title: string): string {
  return (
    `Help me do it: ${title}\n` +
    "Give it to the agent whose job it is. If you have what you need, have them draft it here for me to edit. " +
    "If not, interview me one question at a time first. Nothing is sent to anyone, and the reminder stays open until I mark it done."
  );
}

/** Sent once per home, so Firstmate files the owner's rule itself. */
export const draftingRule =
  "The captain asks, in their own words: “When you remind me about something I have to write, such as an email, draft it or ask me to draft it, or interview me if you have no context to understand and draft it.” File this as a standing rule where it belongs, and follow it from now on.";

/**
 * Sent once per home (key `prd-discovery-charter-v1`), instructing Firstmate
 * to install or update the Product Manager (`prd`) charter and workflow
 * guidance through its native ownership path and collaborate with Research &
 * Insights (`researcher`), Product Marketing (`product-marketing`), and UX
 * (`designer`).
 */
export const prdDiscoveryCharterRule = [
  "The captain asks you to update your registered Product Manager (`prd`) secondmate's charter or workflow guidance through your native ownership path, and verify `prd`, `researcher` (Research & Insights), `product-marketing` (Product Marketing), and `designer` (UX) against your active roster and scope:",
  "",
  "In every PRD interview, establish the customer’s real pain before settling the solution. Review supplied sources and existing answers first. Run at least three distinct why probes. Establish why the pain occurs in the current workflow, why the suspected cause or limitation persists, and why its impact matters to the customer and business. Resolve probes from available evidence where possible and bring consequential unknowns to me via Firstmate, one question at a time, with choices, your recommendation and a custom answer. Summarize the evidence and conclusions in the PRD. Label assumptions, conflicting evidence and validation needs. Keep claims such as causes, frequencies, customer quotes and baselines traceable to evidence or identified as unknown.",
  "",
  "Finish discovery with one clear problem statement in a single format from the list below. Choose the best fit and say why. Keep the statement about customer pain and the desired outcome. If the specific user, real pain, impact or evidence remains materially unclear, keep it in discovery or visibly provisional and record what would validate it. A working draft can still progress:",
  "- Evidence-led 5W+H (the default): Specific segment, desired outcome, when and where the failure occurs, evidenced cause or current limitation, customer and business impact. Quantify only with a source or label the measurement pending.",
  "- Jobs to Be Done: Trigger, specific customer, desired progress, obstacle, current workaround and cost, delay or risk. Useful when motivation and switching behavior matter.",
  "- Outcome–Evidence–Scope: Segment, context and supported cause, source-backed evidence, customer and business impact, measurable desired change and explicit non-goals. Useful for stakeholder alignment.",
  "",
  "For missing market, competitive or technical evidence, give Firstmate a bounded research question, scope, authorized sources and a return request. Firstmate should delegate to the registered Research & Insights (`researcher`) secondmate and return findings with sources, uncertainty and limitations to Product Manager. Also collaborate via Firstmate with Product Marketing (`product-marketing`) for positioning, value proposition, customer voice, competitive battlecards, pricing/packaging and GTM input, and with UX (`designer`) for user journey insights, flows, service blueprints and UX best practices. Product Manager owns synthesis, the captain interview and the brief. Firstmate stays the captain-facing channel. Preserve the reviewer challenge and record how substantive issues were resolved or escalated before the PRD is ready.",
  "",
  "Maintain a 20-topic PRD interview coverage checklist in the brief or its interview notes (mark each topic evidenced, captain-confirmed, assumption, open or not applicable with a reason; an open issue or assumption is visible and cannot count as a confirmed answer):",
  "1. Specific customer and boundaries with adjacent segments",
  "2. Customer job and desired outcome",
  "3. Current workflow and handoffs",
  "4. Painful step, frequency and consequence",
  "5. Alternatives, workarounds or doing nothing",
  "6. Sources that establish the pain and confidence in those sources",
  "7. Customer-visible improvement when it works",
  "8. Ideal end-to-end experience",
  "9. Smallest valuable scope",
  "10. Core capabilities needed",
  "11. Launch must-haves and non-goals",
  "12. Business objective and why it matters",
  "13. Primary success measure, baseline and target where known, guardrails",
  "14. Demand, reachable market and willingness to pay where relevant",
  "15. Alternatives on value, price, speed, quality and switching cost where relevant",
  "16. Decision makers, approvers, contributors and affected stakeholders",
  "17. Functional and nonfunctional requirements, edge cases, permissions, data, integrations and errors",
  "18. Technical, privacy, security, legal, operational and third-party constraints",
  "19. Risks, contradictions, assumptions, open decisions and owners",
  "20. Delivery sequence, dependencies, deferred scope and launch prerequisites",
  "",
  "Default to a PRD for product build requirements. Reuse the structured interview for a PR/FAQ if the requested decision is about the customer proposition or market opportunity, or a BRD if it is about business process, stakeholders and constraints. Keep exact approved versions and show the review decision in the original chat and Library.",
].join("\n");
