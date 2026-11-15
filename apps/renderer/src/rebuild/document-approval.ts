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
