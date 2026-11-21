import { z } from "zod";
import { backlogResult } from "@amun/contracts";
import { browserStore } from "../backlog-selection.ts";
import { scopedDraftKey, type PlanningScope } from "./planning-draft.ts";

const snapshot = z.object({
  at: z.string().datetime(),
  name: z.string(),
  iteration: z.string(),
  members: z.array(z.object({ id: z.string(), title: z.string() })),
  result: backlogResult,
});
type Snapshot = z.infer<typeof snapshot>;
export function readPlanningCache(scope: Omit<PlanningScope, "iteration">) {
  try {
    const raw = browserStore()?.getItem(scopedDraftKey(scope) + ":snapshot");
    if (!raw) return null;
    const parsed = snapshot.parse(JSON.parse(raw));
    return parsed.result.productId === scope.productId &&
      parsed.result.view === "cards"
      ? { ...parsed, result: parsed.result }
      : null;
  } catch {
    return null;
  }
}
export function savePlanningCache(scope: PlanningScope, value: Snapshot) {
  try {
    browserStore()?.setItem(
      scopedDraftKey(scope) + ":snapshot",
      JSON.stringify(value),
    );
  } catch {}
}
