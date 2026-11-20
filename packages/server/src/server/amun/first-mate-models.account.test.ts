import { describe, expect, it } from "vitest";
import { checkPiAccount } from "./first-mate-models.js";

const answering = (printed: string, fails = false) => async () => {
  if (fails) throw Object.assign(new Error("exit 2"), { stdout: printed });
  return printed;
};

describe("asking Pi whether a provider is signed in", () => {
  it("reads a ready sign-in", async () => {
    expect(
      await checkPiAccount(
        "openai-codex",
        answering('{"status":"ready","provider":"openai-codex","authType":"oauth"}'),
      ),
    ).toEqual({ provider: "openai-codex", status: "ready", reason: null });
  });

  it("calls a sign-in Pi could not renew a sign-in to redo, not a service fault", async () => {
    // What Pi printed for Claude Pro/Max on 20 November 2026, exiting 2.
    expect(
      await checkPiAccount(
        "anthropic",
        answering('{"status":"invalid","provider":"anthropic","reason":"invalid_state"}', true),
      ),
    ).toEqual({ provider: "anthropic", status: "missing", reason: "invalid_state" });
  });

  it("keeps other failures as errors", async () => {
    expect(
      await checkPiAccount(
        "openrouter",
        answering('{"status":"not_ready","provider":"openrouter","reason":"quota"}', true),
      ),
    ).toEqual({ provider: "openrouter", status: "error", reason: "quota" });
    expect(await checkPiAccount("openrouter", answering("", true))).toEqual({
      provider: "openrouter",
      status: "error",
      reason: "check_failed",
    });
  });
});
