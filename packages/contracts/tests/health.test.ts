import { describe, expect, it } from "vitest";
import { healthRequest, healthResponse } from "../src/index.js";

describe("versioned health RPC boundary", () => {
  const request = { version: 1, id: "request-1", method: "health", params: {} };
  it("round-trips a health request without mutation", () => {
    expect(healthRequest.parse(JSON.parse(JSON.stringify(request)))).toEqual(
      request,
    );
  });
  it.each([
    { ...request, version: 2 },
    { ...request, id: "" },
    { ...request, method: "execute" },
    { ...request, params: { command: "rm" } },
    { ...request, token: "must-not-cross-boundary" },
    null,
  ])("rejects unsupported or injected requests: %j", (input) => {
    expect(healthRequest.safeParse(input).success).toBe(false);
  });
  it("preserves reconnecting instead of claiming readiness", () => {
    const response = { version: 1, id: "request-1", status: "reconnecting" };
    expect(healthResponse.parse(response)).toEqual(response);
  });
  it.each(["unknown-success", "", null, 1])(
    "rejects unrecognised status %j",
    (status) => {
      expect(
        healthResponse.safeParse({ version: 1, id: "request-1", status })
          .success,
      ).toBe(false);
    },
  );
});
