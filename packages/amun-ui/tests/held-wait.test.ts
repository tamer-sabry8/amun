import { describe, expect, it } from "vitest";
import { waitParts, waitReason } from "../src/rebuild/held-wait.ts";

describe("waiting message reason", () => {
  it("treats a saved message without a reason as a provider wait", () => {
    expect(waitReason({})).toBe("provider");
    expect(waitReason({ reason: "provider" })).toBe("provider");
    expect(waitReason({ reason: "busy" })).toBe("busy");
  });
  it("shows the provider alert only for a provider wait", () => {
    expect(waitParts("provider")).toEqual({ tag: true, providerAlert: true });
    expect(waitParts("busy")).toEqual({ tag: true, providerAlert: false });
  });
});
