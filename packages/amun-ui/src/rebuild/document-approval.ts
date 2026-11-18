// What the owner has approved of a saved document, in plain words. Only the
// owner's title menu approves; later edits never carry the approval along.
import type { WorkSnapshot } from "../../../../packages/contracts/src/work.ts";

type Library = WorkSnapshot["library"][number];

export type ApprovalState =
  | { state: "none" }
  | { state: "approved"; version: number }
  | { state: "changed"; version: number };

export function approvalOf(
  item: Pick<Library, "section" | "version" | "approvedVersion">,
): ApprovalState {
  if (item.section !== "output" || typeof item.approvedVersion !== "number")
    return { state: "none" };
  return item.version > item.approvedVersion
    ? { state: "changed", version: item.approvedVersion }
    : { state: "approved", version: item.approvedVersion };
}

export function approvalLabel(approval: ApprovalState) {
  if (approval.state === "approved") return `Approved (v${approval.version})`;
  if (approval.state === "changed")
    return `Changed since approval (v${approval.version} approved)`;
  return "";
}

export const authorLabel = {
  owner: "You",
  firstmate: "Firstmate",
  agent: "A crew agent",
} as const;

export type Decision = "accepted" | "not_yet" | "rejected";
export const decisionWords: Record<Decision, string> = {
  accepted: "Accepted",
  not_yet: "Not yet",
  rejected: "Rejected",
};

/** The owner's acceptance of a checklist, kept apart from approval and publishing. */
export function acceptanceLabel(item: Pick<Library, "version" | "acceptance">) {
  const { acceptance } = item;
  if (!acceptance) return "";
  return item.version > acceptance.version
    ? `Changed since your decision (v${acceptance.version} ${decisionWords[acceptance.decision].toLowerCase()})`
    : `${decisionWords[acceptance.decision]} (v${acceptance.version})`;
}
