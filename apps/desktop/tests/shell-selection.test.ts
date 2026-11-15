import { describe, it, expect } from "vitest";
import { hideWindowsForTests, shellQuery } from "../src/shell-selection.ts";

const base = {
  isPackaged: false,
  hasProofSwitch: false,
  hasGallerySwitch: false,
  hasLegacySwitch: false,
  env: {},
};
describe("shellQuery", () => {
  it("never selects the legacy shell in a packaged build", () => {
    expect(
      shellQuery({
        ...base,
        isPackaged: true,
        hasLegacySwitch: true,
        hasGallerySwitch: true,
        env: { AMUN_LEGACY_SHELL: "1" },
      }),
    ).toEqual({ packaged: "1" });
  });
  it("keeps the legacy shell for unpackaged test runs", () => {
    expect(shellQuery({ ...base, env: { AMUN_LEGACY_SHELL: "1" } })).toEqual({
      legacy: "1",
    });
    expect(shellQuery({ ...base, hasLegacySwitch: true })).toEqual({
      legacy: "1",
    });
    expect(shellQuery(base)).toEqual({});
  });
});
describe("hideWindowsForTests", () => {
  it("hides under Playwright, never when packaged", () => {
    expect(hideWindowsForTests({ isPackaged: false, env: {} })).toBe(false);
    expect(
      hideWindowsForTests({
        isPackaged: false,
        env: { AMUN_E2E_HIDE_WINDOWS: "1" },
      }),
    ).toBe(true);
    expect(
      hideWindowsForTests({
        isPackaged: false,
        env: { AMUN_E2E_TEST_PROVIDERS: "x" },
      }),
    ).toBe(true);
    expect(
      hideWindowsForTests({
        isPackaged: true,
        env: { AMUN_E2E_HIDE_WINDOWS: "1" },
      }),
    ).toBe(false);
  });
});
