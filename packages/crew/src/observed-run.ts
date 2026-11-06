import { run, type Run } from "../../contracts/src/entities.ts";
import type { FirstmateRecord } from "./tmux-observer.ts";
/** Endpoint existence does not establish model, semantic status, role or start time. */
export function observedRun(
  productId: string,
  record: FirstmateRecord,
  branch: string,
): Run {
  return run.parse({
    id: record.taskId + ":" + record.spawnGeneration,
    productId,
    storyId: null,
    agentRole: "unknown",
    harness: record.harness === "claude" ? "claude_code" : "codex",
    model: "unknown",
    firstmateTaskId: record.taskId,
    backend: "tmux",
    paneRef: record.window,
    worktree: record.worktree,
    branch,
    state: "unknown",
    startedAt: null,
  });
}
