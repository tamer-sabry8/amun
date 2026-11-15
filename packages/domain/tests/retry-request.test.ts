import { describe, expect, it } from "vitest";
import { retryIntent, retryTarget } from "../src/work/retry-request.ts";

const plan = (id: string, state: string, summary = "Login page") => ({
  id,
  workAreaId: "a",
  state,
  items: [{ id: id + "-i", summary }],
  results: [{ id: id + "-i", state: "failed" }],
});

describe("retry requests in words", () => {
  it("recognises a request to retry", () => {
    expect(retryIntent("Please retry the Login page")).toBe(true);
    expect(retryIntent("try again")).toBe(true);
    expect(retryIntent("Why did the retry fail?")).toBe(false);
  });
  it("finds the failed item's plan under its own approval", () => {
    expect(retryTarget([plan("p1", "failed")], "a", "retry")).toEqual({
      kind: "retry",
      planId: "p1",
    });
    expect(
      retryTarget(
        [plan("p1", "failed"), plan("p2", "failed", "Reports")],
        "a",
        "retry reports",
      ),
    ).toEqual({ kind: "retry", planId: "p2" });
    expect(
      retryTarget(
        [plan("p1", "failed"), plan("p2", "failed", "Reports")],
        "a",
        "retry",
      ),
    ).toEqual({ kind: "ambiguous" });
  });
  it("never retries a plan that is no longer approved", () => {
    expect(retryTarget([plan("p1", "proposed")], "a", "retry")).toEqual({
      kind: "review",
      planId: "p1",
    });
    expect(retryTarget([], "a", "retry")).toEqual({ kind: "none" });
  });
});
