import { it, expect } from "vitest";
import { authBrowserArgs } from "../src/auth-browser.ts";
it("forces Edge for provider sign-in and rejects unrelated destinations before launch", () => {
  expect(
    authBrowserArgs(
      "github-copilot",
      "https://tahaluf.ghe.com/login/device",
      "tahaluf.ghe.com",
    ),
  ).toEqual(["-a", "Microsoft Edge", "https://tahaluf.ghe.com/login/device"]);
  expect(() =>
    authBrowserArgs(
      "github-copilot",
      "https://evil.test/login",
      "tahaluf.ghe.com",
    ),
  ).toThrow();
});
