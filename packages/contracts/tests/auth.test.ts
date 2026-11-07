import { it, expect } from "vitest";
import { authCommand, authEvent } from "../src/auth.ts";
it("accepts explicit connection/login actions and rejects extra secret output fields", () => {
  expect(
    authCommand.safeParse({
      version: 1,
      kind: "auth",
      action: "login",
      provider: "github-copilot",
      type: "oauth",
    }).success,
  ).toBe(true);
  expect(
    authCommand.safeParse({
      version: 1,
      kind: "auth",
      action: "login",
      provider: "anthropic",
      type: "oauth",
    }).success,
  ).toBe(false);
  expect(
    authCommand.safeParse({
      version: 1,
      kind: "auth",
      action: "save",
      connection: { kind: "github", baseUrl: "https://github.com" },
      secret: "token",
    }).success,
  ).toBe(true);
  expect(
    authEvent.safeParse({
      version: 1,
      kind: "auth-status",
      id: "github",
      status: "configured",
      secret: "token",
    }).success,
  ).toBe(false);
  expect(
    authEvent.safeParse({
      version: 1,
      kind: "auth-prompt",
      id: "p",
      method: "secret",
      message: "Enter API key",
      options: [],
    }).success,
  ).toBe(true);
  expect(
    authCommand.safeParse({
      version: 1,
      kind: "auth",
      action: "answer",
      id: "p",
      answer: "x".repeat(65537),
    }).success,
  ).toBe(false);
});
