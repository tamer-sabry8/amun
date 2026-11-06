import { it, expect, vi } from "vitest";
import { CrewObserver } from "../src/crew-observer.ts";
it("observes only validated task identifiers and projects no raw backend records", async () => {
  const read = vi.fn(async () => ({
      endpoint: "verified",
      worker: "unknown",
      secret: "canary",
    })),
    send = vi.fn();
  const observer = new CrewObserver(read, send);
  await observer.handle({
    version: 1,
    kind: "crew-observe",
    taskId: "proof-codex",
  });
  expect(send).toHaveBeenCalledWith({
    version: 1,
    kind: "crew-observation",
    taskId: "proof-codex",
    endpoint: "verified",
    worker: "unknown",
  });
  expect(JSON.stringify(send.mock.calls)).not.toContain("canary");
  await observer.handle({
    version: 1,
    kind: "crew-observe",
    taskId: "../personal",
  });
  expect(read).toHaveBeenCalledTimes(1);
});
it("reports unknown on failure and suppresses results after disconnect", async () => {
  const send = vi.fn(),
    observer = new CrewObserver(async () => {
      throw Error("secret");
    }, send);
  await observer.handle({ version: 1, kind: "crew-observe", taskId: "proof" });
  expect(send).toHaveBeenCalledWith({
    version: 1,
    kind: "crew-observation",
    taskId: "proof",
    endpoint: "unknown",
    worker: "unknown",
  });
  observer.close();
  await observer.handle({ version: 1, kind: "crew-observe", taskId: "proof" });
  expect(send).toHaveBeenCalledTimes(1);
});

it("publishes only a matching validated unknown-state Run", async () => {
  const value = {
    id: "run",
    productId: "m0",
    storyId: null,
    agentRole: "unknown",
    harness: "codex",
    model: "unknown",
    firstmateTaskId: "proof",
    backend: "tmux",
    paneRef: "firstmate:proof",
    worktree: "/owned/work",
    branch: "main",
    state: "unknown",
    startedAt: null,
  };
  for (const candidate of [
    value,
    { ...value, secret: "canary" },
    { ...value, firstmateTaskId: "another" },
    { ...value, state: "completed" },
  ]) {
    const send = vi.fn();
    const observer = new CrewObserver(
      async () => ({ endpoint: "verified", run: candidate }),
      send,
    );
    await observer.handle({
      version: 1,
      kind: "crew-observe",
      taskId: "proof",
    });
    expect(send.mock.calls[0]![0].run).toEqual(
      candidate === value ? value : undefined,
    );
    expect(JSON.stringify(send.mock.calls)).not.toContain("canary");
  }
});
