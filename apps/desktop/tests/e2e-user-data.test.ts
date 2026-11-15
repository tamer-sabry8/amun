import { describe, it, expect } from "vitest";
import { e2eUserData } from "../src/e2e-user-data.ts";

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
