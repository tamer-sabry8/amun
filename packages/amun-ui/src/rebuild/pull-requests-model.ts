// Pure rules for the Pull requests view: wording and the merge stage.
export type Method = "squash" | "merge" | "rebase";
export const methodLabels: Record<Method, string> = {
  squash: "Squash and merge",
  merge: "Merge commit",
  rebase: "Rebase and merge",
};

export function checksLabel(checks?: string) {
  return checks === "passing"
    ? { text: "Checks passing", tone: "good" }
    : checks === "failing"
      ? { text: "Checks failing", tone: "bad" }
      : checks === "running"
        ? { text: "Checks running", tone: "warn" }
        : { text: "No checks", tone: "" };
}

/** "3 files · +20 −4"; empty when the provider did not say. */
export function changeSummary(row: {
  files?: number | undefined;
  additions?: number | undefined;
  deletions?: number | undefined;
}) {
  if (row.files === undefined) return "";
  return `${row.files} ${row.files === 1 ? "file" : "files"} · +${row.additions ?? 0} −${row.deletions ?? 0}`;
}

export const shortHead = (head: string) => head.slice(0, 7);

export type MergeStage =
  "none" | "approve" | "merge" | "verify" | "merged" | "stale";

/**
 * Where the merge plan stands. A plan is only good for the exact version the
 * owner reviewed: if the pull request has moved on, nothing proceeds until a
 * new plan is made.
 */
export function mergeStage(
  review: { head: string; state: string } | undefined,
  detail: { head: string; merged: boolean },
): MergeStage {
  if (!review) return "none";
  if (review.state === "succeeded") return detail.merged ? "merged" : "none";
  if (review.state === "unknown") return "verify";
  if (detail.merged) return "none";
  if (review.state === "invalidated" || review.head !== detail.head)
    return "stale";
  if (review.state === "pending_approval") return "approve";
  if (review.state === "approved") return "merge";
  return "none";
}

type Action =
  | "list"
  | "details"
  | "file"
  | "review"
  | "prepare"
  | "approve"
  | "execute"
  | "accept";
const done: Record<Action, string> = {
  list: "",
  details: "",
  file: "",
  review: "Your review was sent.",
  prepare: "Here is the merge plan. Nothing is merged until you approve it.",
  approve: "Approved. You can merge it now.",
  execute: "Merged.",
  accept: "Your decision was saved.",
};

/** Friendly status text for a result; the provider's own wording is a fallback. */
export function resultMessage(
  action: Action,
  ok: boolean,
  message: string,
  rows = 0,
) {
  if (ok)
    return action === "list"
      ? rows
        ? `${rows} open ${rows === 1 ? "pull request" : "pull requests"}.`
        : "No open pull requests."
      : done[action];
  if (changed(message))
    return "This pull request changed since you looked. Nothing was merged. Open it again to see the new version.";
  return message || "That did not work. Check the connection and try again.";
}

/** The provider says the version moved on (it names the head or base). */
export const changed = (message: string) =>
  /head|base changed|changed during|changed since/i.test(message);
