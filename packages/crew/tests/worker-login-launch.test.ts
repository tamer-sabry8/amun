import { it, expect } from "vitest";
import {
  workerLoginScript,
  workerLoginRequest,
} from "../src/worker-login-launch.ts";
it("accepts only the two explicit CLI choices and quotes launch paths as literal arguments", () => {
  expect(workerLoginRequest({ tool: "codex" })).toBe("codex");
  expect(workerLoginRequest({ tool: "claude" })).toBe("claude");
  for (const input of [
    { tool: "other" },
    { tool: "codex", args: ["bad"] },
    null,
  ])
    expect(workerLoginRequest(input)).toBeNull();
  const script = workerLoginScript(
    "/App's Amun/$(bad)",
    "/owned/login.cjs",
    "codex",
  );
  expect(script).toContain("'/App'\\''s Amun/$(bad)'");
  expect(script).toContain("ELECTRON_RUN_AS_NODE=1");
  expect(script).toContain("'codex'");
  expect(() => workerLoginScript("relative", "/helper", "codex")).toThrow();
  expect(() =>
    workerLoginScript("/app\ninvalid", "/helper", "codex"),
  ).toThrow();
});
