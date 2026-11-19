import { describe, expect, it } from "vitest";
import { statusLabel } from "../src/rebuild/screens.tsx";

describe("Portfolio status wording", () => {
  it("shows a status in plain words, capitalised", () => {
    expect(statusLabel("active")).toBe("Active");
    expect(statusLabel("on hold")).toBe("On hold");
    expect(statusLabel("")).toBe("");
  });
});
