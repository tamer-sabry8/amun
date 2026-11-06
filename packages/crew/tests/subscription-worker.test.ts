import { runClosedInput } from "../src/closed-input.ts";
import { it, expect, vi } from "vitest";
import { SubscriptionWorker } from "../src/subscription-worker.ts";
it("uses official CLI subscription status and never calls configured proof inference", async () => {
  const run = vi.fn<typeof runClosedInput>(async () => ({
    stdout: "",
    stderr: "Logged in using ChatGPT",
  }));
  const worker = new SubscriptionWorker(
    { home: "/Users/test", binary: "/app/Amun", tool: "codex" },
    run,
    async () => {},
  );
  expect(await worker.status()).toBe(
    "Codex CLI subscription configured; inference has not been checked.",
  );
  expect(run.mock.calls[0]![1]).toEqual([
    "/Users/test/.local/bin/codex",
    "login",
    "status",
  ]);
  expect(run.mock.calls[0]![2].env).toMatchObject({
    ELECTRON_RUN_AS_NODE: "1",
    CODEX_HOME:
      "/Users/test/Library/Application Support/Amun/workers/m0-codex/state",
  });
  expect(run.mock.calls[0]![2].env).not.toHaveProperty("OPENAI_API_KEY");
});
it("accepts only a completed expected Codex reply without tool activity", async () => {
  const run = vi.fn<typeof runClosedInput>(async () => ({
    stdout: "",
    stderr: "",
  }));
  const worker = new SubscriptionWorker(
    { home: "/Users/test", binary: "/app/Amun", tool: "codex" },
    run,
    async () => {},
  );
  await expect(worker.infer()).rejects.toThrow();
  run.mockResolvedValue({
    stdout:
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "AMUN_M1_CODEX_OK" },
      }) +
      "\n" +
      JSON.stringify({ type: "turn.completed" }),
    stderr: "",
  });
  expect(await worker.infer()).toContain("completed successfully");
  run.mockResolvedValue({
    stdout:
      JSON.stringify({ type: "turn.completed" }) +
      "\n" +
      JSON.stringify({
        type: "item.completed",
        item: { type: "command_execution" },
      }),
    stderr: "",
  });
  await expect(worker.infer()).rejects.toThrow();
});
it("requires Claude subscription authentication and checks its completed result", async () => {
  const run = vi.fn<typeof runClosedInput>(async () => ({
    stdout: JSON.stringify({ loggedIn: true, authMethod: "api_key" }),
    stderr: "",
  }));
  const worker = new SubscriptionWorker(
    { home: "/Users/test", binary: "/app/Amun", tool: "claude" },
    run,
    async () => {},
  );
  expect(await worker.status()).toContain("not configured");
  run.mockResolvedValue({
    stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }),
    stderr: "",
  });
  expect(await worker.status()).toContain("subscription configured");
  run.mockResolvedValue({
    stdout: JSON.stringify({
      type: "result",
      is_error: false,
      result: "AMUN_M1_CLAUDE_OK",
    }),
    stderr: "",
  });
  expect(await worker.infer()).toContain("completed successfully");
});

it("refuses missing owned profiles before invoking a CLI", async () => {
  const run = vi.fn<typeof runClosedInput>();
  const worker = new SubscriptionWorker(
    { home: "/amun-nonexistent-user", binary: "/app/Amun", tool: "codex" },
    run,
  );
  await expect(worker.status()).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
});
