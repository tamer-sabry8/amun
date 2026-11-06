import { it, expect } from "vitest";
import { observedRun } from "../src/observed-run.ts";
it("maps verified task identity into a stable Run without inventing model or completion", () => {
  const record = {
    backend: "tmux",
    taskId: "task-1",
    window: "firstmate:task-1",
    worktree: "/owned/work",
    spawnGeneration: "generation-1",
    harness: "claude",
  } as const;
  const value = observedRun("m0", record, "amun/worker");
  expect(value).toMatchObject({
    productId: "m0",
    firstmateTaskId: "task-1",
    harness: "claude_code",
    model: "unknown",
    state: "unknown",
    startedAt: null,
    branch: "amun/worker",
    worktree: "/owned/work",
  });
  expect(observedRun("m0", record, "amun/worker").id).toBe(value.id);
  expect(
    observedRun(
      "m0",
      { ...record, spawnGeneration: "generation-2" },
      "amun/worker",
    ).id,
  ).not.toBe(value.id);
  expect(
    observedRun("m0", { ...record, harness: "codex" }, "main").harness,
  ).toBe("codex");
  expect(() => observedRun("", record, "amun/worker")).toThrow();
  expect(() => observedRun("m0", record, "")).toThrow();
});
