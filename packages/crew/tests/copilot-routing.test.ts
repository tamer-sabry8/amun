import { describe, expect, it } from "vitest";
import {
  allowedProviders,
  chooseCopilotModel,
  CopilotUnavailable,
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
