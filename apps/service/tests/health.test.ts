import { describe, expect, it } from "vitest";
import { handleHealthRequest, restartDelay } from "../src/health.js";

describe("service boundary", () => {
  it("responds with the request correlation ID", () => {
    expect(
      handleHealthRequest({
        version: 1,
        id: "req-1",
        method: "health",
        params: {},
      }),
    ).toEqual({ version: 1, id: "req-1", status: "ready" });
  });
  it.each([
    null,
    {},
    { version: 1, id: "req-1", method: "execute", params: {} },
    {
      version: 1,
      id: "req-1",
      method: "health",
      params: { command: "publish" },
    },
  ])("rejects invalid or privileged messages without executing %#", (input) => {
    expect(handleHealthRequest(input)).toBeNull();
  });
  it("backs off repeated crashes with a bounded delay", () => {
    expect([0, 1, 2, 3, 20].map(restartDelay)).toEqual([
      100, 200, 400, 800, 2000,
    ]);
  });
  it.each([-1, 0.5, NaN, Infinity])(
    "rejects an invalid restart attempt %j",
    (input) => {
      expect(() => restartDelay(input)).toThrow(RangeError);
    },
  );
});
