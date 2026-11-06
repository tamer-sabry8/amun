import { it, expect } from "vitest";
import { workerEnvironment } from "../src/worker-environment.ts";
it("disables updates and keeps Claude profile separate while retaining macOS Keychain discovery", () => {
  const env = workerEnvironment(
    "claude",
    "/Users/test",
    "/Users/test/Amun/claude",
    "/tools/node",
  );
  expect(env).toMatchObject({
    HOME: "/Users/test",
    CLAUDE_CONFIG_DIR: "/Users/test/Amun/claude/state",
    DISABLE_UPDATES: "1",
    DISABLE_AUTOUPDATER: "1",
  });
  expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
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
