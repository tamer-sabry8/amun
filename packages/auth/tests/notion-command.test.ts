import { expect, it } from "vitest";
import { authCommand } from "../../contracts/src/auth.ts";
it("accepts only explicit Notion browser actions and rejects arbitrary browser commands", () => {
  expect(
    authCommand.safeParse({
      version: 1,
      kind: "auth",
      action: "notion-connect",
      browser: "edge",
    }).success,
  ).toBe(true);
  expect(
    authCommand.safeParse({
      version: 1,
      kind: "auth",
      action: "notion-connect",
      browser: "dia",
    }).success,
  ).toBe(true);
  expect(
    authCommand.safeParse({
      version: 1,
      kind: "auth",
      action: "notion-connect",
      browser: "/bin/sh",
    }).success,
  ).toBe(false);
  expect(
    authCommand.safeParse({
      version: 1,
      kind: "auth",
      action: "notion-connect",
      browser: "edge",
      url: "https://evil.test",
    }).success,
  ).toBe(false);
});
