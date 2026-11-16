import { expect, it } from "vitest";
import { modelArguments } from "../src/firstmate-supervision.ts";

it("pins Copilot unless e2e fixtures are declared", () => {
  expect(modelArguments({})).toEqual([
    "--provider",
    "github-copilot",
    "--model",
    "github-copilot/claude-sonnet-5.5",
  ]);
  expect(modelArguments({ AMUN_E2E_TEST_PROVIDERS: "amun-queue" })).toEqual([]);
});
