import { it, expect } from "vitest";
import { officialWorkerLoginUrl } from "../src/worker-login-url.ts";
it("recognizes the actual Claude authorization host from bounded CLI output", () => {
  expect(
    officialWorkerLoginUrl(
      "claude",
      "Open https://claude.com/cai/oauth/authorize?code=true&state=canary\n",
    ),
  ).toBe("https://claude.com/cai/oauth/authorize?code=true&state=canary");
  expect(
    officialWorkerLoginUrl(
      "codex",
      "https://auth.openai.com/oauth/authorize?state=canary",
    ),
  ).toBe("https://auth.openai.com/oauth/authorize?state=canary");
});
it("refuses lookalikes, credentials, other paths, ports, schemes and unbounded output", () => {
  for (const url of [
    "http://claude.com/cai/oauth/authorize",
    "https://claude.com.evil.test/cai/oauth/authorize",
    "https://user@claude.com/cai/oauth/authorize",
    "https://claude.com:444/cai/oauth/authorize",
    "https://claude.com/other",
    "https://auth.openai.com/oauth/authorize",
  ])
    expect(officialWorkerLoginUrl("claude", url)).toBeUndefined();
  expect(officialWorkerLoginUrl("claude", "x".repeat(65537))).toBeUndefined();
});

it("opens once after the complete URL arrives across stdout chunks", async () => {
  const { WorkerLoginBrowser } = await import("../src/worker-login-url.ts");
  const opened: string[] = [];
  const bridge = new WorkerLoginBrowser("claude", (url) => opened.push(url));
  bridge.receive("https://claude.com/cai/oauth/authorize?state=");
  expect(opened).toEqual([]);
  bridge.receive("canary\n");
  bridge.receive("https://claude.com/cai/oauth/authorize?state=canary\n");
  expect(opened).toEqual([
    "https://claude.com/cai/oauth/authorize?state=canary",
  ]);
});
