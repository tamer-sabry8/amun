import { describe, expect, it } from "vitest";
import {
  allowedProviders,
  chooseCopilotModel,
  CopilotUnavailable,
  savedModelLabel,
  testProviders,
} from "../src/copilot-routing.ts";

const message =
  "GitHub Copilot is not connected or its model is unavailable. Sign in to GitHub Copilot under Settings › Accounts and models.";
const copilot = { provider: "github-copilot", id: "claude-sonnet-5.5" };
const first = { provider: "amun-queue", id: "a" };
const second = { provider: "amun-local", id: "b" };

describe("testProviders", () => {
  it("parses, trims and drops invalid ids", () => {
    const env = (v?: string) => ({ AMUN_E2E_TEST_PROVIDERS: v });
    expect(testProviders({})).toEqual([]);
    expect(testProviders(env(""))).toEqual([]);
    expect(testProviders(env("  , "))).toEqual([]);
    expect(
      testProviders(env(" amun-queue , Bad/Id,amun-local,-x,a b")),
    ).toEqual(["amun-queue", "amun-local"]);
    expect(allowedProviders(env("amun-queue"))).toEqual([
      "github-copilot",
      "amun-queue",
    ]);
    expect(allowedProviders({})).toEqual(["github-copilot"]);
  });
});

describe("chooseCopilotModel", () => {
  it("requires Copilot when no test providers are declared", () => {
    for (const available of [[], [first]]) {
      expect(() => chooseCopilotModel(available, {})).toThrow(
        CopilotUnavailable,
      );
      expect(() => chooseCopilotModel(available, {})).toThrow(message);
    }
  });
  it("prefers a Copilot model over fixtures", () => {
    expect(chooseCopilotModel([first, copilot], {}, ["amun-queue"])).toBe(
      copilot,
    );
  });
  it("uses the saved fixture, else the first fixture, else nothing", () => {
    const declared = ["amun-queue", "amun-local"];
    expect(
      chooseCopilotModel(
        [first, second],
        { provider: "amun-local", model: "b" },
        declared,
      ),
    ).toBe(second);
    expect(chooseCopilotModel([first, second], {}, declared)).toBe(first);
    expect(chooseCopilotModel([], {}, declared)).toBeUndefined();
    expect(
      chooseCopilotModel([{ provider: "other", id: "x" }], {}, declared),
    ).toBeUndefined();
  });
});

describe("savedModelLabel", () => {
  const signedIn = ["github-copilot"];
  it("uses the saved Copilot model, else the pinned default", () => {
    expect(
      savedModelLabel(
        { defaultProvider: "github-copilot", defaultModel: "gpt-5" },
        signedIn,
      ),
    ).toEqual({ model: "github-copilot/gpt-5", needsConversation: false });
    expect(savedModelLabel({}, signedIn).model).toBe(
      "github-copilot/claude-sonnet-5.5",
    );
    expect(
      savedModelLabel({ defaultProvider: "other", defaultModel: "x" }, signedIn)
        .model,
    ).toBe("github-copilot/claude-sonnet-5.5");
  });
  it("shows no model before Copilot is signed in, even with a saved choice", () => {
    expect(
      savedModelLabel(
        { defaultProvider: "github-copilot", defaultModel: "gpt-5" },
        [],
      ),
    ).toEqual({ model: null, needsConversation: false });
    expect(savedModelLabel(undefined, [])).toEqual({
      model: null,
      needsConversation: false,
    });
  });
  it("leaves declared test fixtures to the conversation", () => {
    expect(savedModelLabel({}, signedIn, ["amun-queue"])).toEqual({
      model: null,
      needsConversation: true,
    });
  });
});
