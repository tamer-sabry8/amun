import { describe, it, expect } from "vitest";
import { e2eRouteOpen, e2eUserData } from "../src/e2e-user-data.ts";

const env = { AMUN_E2E_USER_DATA: "/tmp/p" };
describe("e2eUserData", () => {
  it("redirects unpackaged runs without an explicit switch", () => {
    expect(
      e2eUserData({ isPackaged: false, env, hasUserDataSwitch: false }),
    ).toBe("/tmp/p");
  });
  it("ignores packaged runs, explicit switches and an unset or empty variable", () => {
    expect(
      e2eUserData({ isPackaged: true, env, hasUserDataSwitch: false }),
    ).toBeUndefined();
    expect(
      e2eUserData({ isPackaged: false, env, hasUserDataSwitch: true }),
    ).toBeUndefined();
    expect(
      e2eUserData({ isPackaged: false, env: {}, hasUserDataSwitch: false }),
    ).toBeUndefined();
    expect(
      e2eUserData({
        isPackaged: false,
        env: { AMUN_E2E_USER_DATA: "" },
        hasUserDataSwitch: false,
      }),
    ).toBeUndefined();
  });
});

describe("packaged test route", () => {
  const open = { hasProofSwitch: true, hasTestProvidersSwitch: true };
  it("stays closed for a normal packaged launch or only one switch", () => {
    for (const flags of [
      { hasProofSwitch: false, hasTestProvidersSwitch: false },
      { hasProofSwitch: true, hasTestProvidersSwitch: false },
      { hasProofSwitch: false, hasTestProvidersSwitch: true },
    ]) {
      expect(e2eRouteOpen({ isPackaged: true, ...flags })).toBe(false);
      expect(
        e2eUserData({
          isPackaged: true,
          env,
          hasUserDataSwitch: false,
          ...flags,
        }),
      ).toBeUndefined();
    }
  });
  it("opens for a packaged launch with both switches and always when unpackaged", () => {
    expect(e2eRouteOpen({ isPackaged: true, ...open })).toBe(true);
    expect(
      e2eUserData({
        isPackaged: true,
        env,
        hasUserDataSwitch: false,
        ...open,
      }),
    ).toBe("/tmp/p");
    expect(
      e2eRouteOpen({
        isPackaged: false,
        hasProofSwitch: false,
        hasTestProvidersSwitch: false,
      }),
    ).toBe(true);
  });
});
