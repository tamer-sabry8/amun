import { describe, it, expect } from "vitest";
import { chooseShell } from "../src/shell-selection.ts";

describe("chooseShell", () => {
  it("packaged builds always get the rebuilt shell", () => {
    expect(chooseShell("?packaged=1&legacy=1")).toBe("rebuilt");
    expect(chooseShell("?legacy=1&packaged=1&gallery=1")).toBe("rebuilt");
  });
  it("unpackaged runs keep the test-only legacy shell", () => {
    expect(chooseShell("?legacy=1")).toBe("legacy");
    expect(chooseShell("")).toBe("rebuilt");
  });
});
