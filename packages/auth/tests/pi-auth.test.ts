import { it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  statSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  preparePiAuth,
  validateLogin,
  authBrowserUrl,
  parseReadiness,
} from "../src/pi-auth.ts";
it("creates only private Amun auth storage and refuses symlink or loose existing credentials", async () => {
  const root = mkdtempSync(join(tmpdir(), "amun-pi-auth-"));
  try {
    const dir = join(root, "pi");
    const file = await preparePiAuth(dir);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).toBe("{}");
    expect(await preparePiAuth(dir)).toBe(file);
    const unsafe = join(root, "unsafe");
    mkdirSync(unsafe, { mode: 0o700 });
    writeFileSync(join(unsafe, "auth.json"), "{}", { mode: 0o644 });
    await expect(preparePiAuth(unsafe)).rejects.toThrow();
    const linked = join(root, "linked");
    symlinkSync(dir, linked);
    await expect(preparePiAuth(linked)).rejects.toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("allows only explicit supported login/provider pairs and provider-owned HTTPS browser URLs", () => {
  expect(() => validateLogin("github-copilot", "oauth")).not.toThrow();
  expect(() => validateLogin("anthropic", "oauth")).toThrow();
  expect(() => validateLogin("unknown", "api_key")).toThrow();
  expect(
    authBrowserUrl("github-copilot", "https://github.com/login/device"),
  ).toBe("https://github.com/login/device");
  expect(
    authBrowserUrl(
      "openrouter",
      "https://openrouter.ai/auth?code_challenge=challenge",
    ),
  ).toContain("openrouter.ai");
  for (const url of [
    "https://github.com.attacker.test/login",
    "http://github.com/login",
    "https://user:pass@github.com/login",
    "file:///tmp",
    "https://github.com:444/login",
  ])
    expect(() => authBrowserUrl("github-copilot", url)).toThrow();
});
it("readiness uses the pinned CLI result and cannot leak credentials or imply successful inference", () => {
  expect(
    parseReadiness(
      "github-copilot",
      JSON.stringify({ provider: "github-copilot", status: "ready" }),
    ),
  ).toBe("configured");
  expect(
    parseReadiness(
      "github-copilot",
      JSON.stringify({ provider: "other", status: "ready" }),
    ),
  ).toBe("error");
  expect(parseReadiness("openrouter", "not json")).toBe("error");
  expect(
    parseReadiness(
      "openrouter",
      JSON.stringify({
        provider: "openrouter",
        status: "ready",
        credentials: "secret",
      }),
    ),
  ).toBe("error");
});
it("binds Copilot browser handoff to the selected supported GHE.com tenant", async () => {
  const { copilotHost } = await import("../src/pi-auth.ts");
  expect(copilotHost("https://tahaluf.ghe.com/")).toBe("tahaluf.ghe.com");
  expect(copilotHost("")).toBe("github.com");
  expect(() => copilotHost("https://ghes.tahaluf.ae/")).toThrow();
  expect(
    authBrowserUrl(
      "github-copilot",
      "https://tahaluf.ghe.com/login/device",
      "tahaluf.ghe.com",
    ),
  ).toContain("tahaluf.ghe.com");
  for (const url of [
    "https://other.ghe.com/login/device",
    "https://github.com/login/device",
    "https://tahaluf.ghe.com.evil.test/login/device",
  ])
    expect(() =>
      authBrowserUrl("github-copilot", url, "tahaluf.ghe.com"),
    ).toThrow();
});
