import { it, expect, vi } from "vitest";
import { openBackendTerminal } from "../src/backend-terminal.ts";
it("never starts a terminal for an invalid task identity or missing receipt", async () => {
  const spawn = vi.fn();
  await expect(
    openBackendTerminal(
      "/missing-amun-receipts",
      "../personal",
      "/usr/bin/tmux",
      spawn,
    ),
  ).rejects.toThrow();
  await expect(
    openBackendTerminal(
      "/missing-amun-receipts",
      "proof",
      "/usr/bin/tmux",
      spawn,
    ),
  ).rejects.toThrow();
  expect(spawn).not.toHaveBeenCalled();
});
