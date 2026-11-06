import { it, expect } from "vitest";
import { workerEnvironment } from "../src/worker-environment.ts";
it("allows supported tool updates and keeps Claude profile separate while retaining macOS Keychain discovery", () => {
  const env = workerEnvironment(
    "claude",
    "/Users/test",
    "/Users/test/Amun/claude",
    "/tools/node",
  );
  expect(env).toMatchObject({
    HOME: "/Users/test",
    CLAUDE_CONFIG_DIR: "/Users/test/Amun/claude/state",
  });
  expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
  expect(env).not.toHaveProperty("DISABLE_UPDATES");
  expect(env).not.toHaveProperty("DISABLE_AUTOUPDATER");
});
it("isolates Codex HOME and validates profile paths", () => {
  expect(
    workerEnvironment(
      "codex",
      "/Users/test",
      "/Users/test/Amun/codex",
      "/tools/node",
    ),
  ).toMatchObject({
    HOME: "/Users/test/Amun/codex/home",
    CODEX_HOME: "/Users/test/Amun/codex/state",
  });
  expect(() =>
    workerEnvironment("claude", "relative", "/root", "/tools/node"),
  ).toThrow();
});
