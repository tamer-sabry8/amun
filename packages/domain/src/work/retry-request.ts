/** The owner asking, in words, to retry something that failed to publish. */

const RETRY =
  /^\s*(?:(?:please|pls|can you|could you|would you|kindly|hey|ok(?:ay)?|and|then)[\s,]+)*(?:retry|re-try|try\s+(?:again|that\s+again|it\s+again|once\s+more)|run\s+(?:the\s+|that\s+)?retry)\b/i;

export function retryIntent(text: string) {
  return RETRY.test(text);
}

export interface RetryPlan {
  id: string;
  workAreaId: string | null;
  state: string;
  items: { id: string; summary: string }[];
  results: { id: string; state: string }[];
}

export type RetryTarget =
  | { kind: "retry"; planId: string }
  | { kind: "review"; planId: string }
  | { kind: "none" }
  | { kind: "ambiguous" };

/**
 * The plan whose failed items the owner means: the one with an item named in
 * the message, else the only one with failures in this work area. A plan that
 * is no longer an approval (edited since) is sent for review, never retried.
 */
export function retryTarget(
  plans: RetryPlan[],
  workAreaId: string,
  text: string,
): RetryTarget {
  const failing = plans.filter(
    (plan) =>
      plan.workAreaId === workAreaId &&
      plan.results.some((result) => result.state === "failed"),
  );
  const said = text.toLowerCase();
  const named = failing.filter((plan) =>
    plan.items.some(
      (item) =>
        plan.results.some(
          (result) => result.id === item.id && result.state === "failed",
        ) &&
        item.summary.trim() &&
        said.includes(item.summary.trim().toLowerCase()),
    ),
  );
  const pick = named.length ? named : failing;
  if (!pick.length) return { kind: "none" };
  if (pick.length > 1) return { kind: "ambiguous" };
  const plan = pick[0]!;
  return ["approved", "partial", "failed"].includes(plan.state)
    ? { kind: "retry", planId: plan.id }
    : { kind: "review", planId: plan.id };
}
