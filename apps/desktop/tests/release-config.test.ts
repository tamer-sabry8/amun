import { afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const configPath = require.resolve("../forge.config.cjs");
const load = () => {
  delete require.cache[configPath];
  return require(configPath).packagerConfig;
};
afterEach(() => vi.unstubAllEnvs());

test("trusted tester beta uses an ad-hoc identity without notarization", () => {
  vi.stubEnv("AMUN_RELEASE", "");
  vi.stubEnv("AMUN_BETA", "1");
  const config = load();
  expect(config.osxSign.identity).toBe("-");
  expect(config.osxSign.identityValidation).toBe(false);
  expect(config.osxSign.optionsForFile("Amun.app").hardenedRuntime).toBe(false);
  expect(config.osxNotarize).toBeUndefined();
  expect(config.appBundleId).toBe("ai.amun.desktop");
});

test("beta mode cannot silently downgrade an explicitly requested signed release", () => {
  vi.stubEnv("AMUN_RELEASE", "1");
  vi.stubEnv("AMUN_BETA", "1");
  expect(load).toThrow(/mutually exclusive/);
});

test("ordinary development packaging does not request signing credentials", () => {
  vi.stubEnv("AMUN_RELEASE", "");
  expect(load().osxSign).toBeUndefined();
  expect(load().osxNotarize).toBeUndefined();
});

test("release packaging refuses absent or incomplete signing configuration", () => {
  vi.stubEnv("AMUN_RELEASE", "1");
  vi.stubEnv("AMUN_SIGN_IDENTITY", "");
  vi.stubEnv("AMUN_NOTARY_PROFILE", "");
  expect(load).toThrow(/Developer ID Application/);
  vi.stubEnv(
    "AMUN_SIGN_IDENTITY",
    "Developer ID Application: Test (ABCDEFGHIJ)",
  );
  expect(load).toThrow(/notarytool/);
});

test("release packaging uses the selected identity and protected notary profile", () => {
  vi.stubEnv("AMUN_RELEASE", "1");
  vi.stubEnv(
    "AMUN_SIGN_IDENTITY",
    "Developer ID Application: Test (ABCDEFGHIJ)",
  );
  vi.stubEnv("AMUN_NOTARY_PROFILE", "amun-test-profile");
  const config = load();
  expect(config.appBundleId).toBe("ai.amun.desktop");
  expect(config.osxSign.identity).toBe(
    "Developer ID Application: Test (ABCDEFGHIJ)",
  );
  expect(config.osxSign.optionsForFile("Amun.app").hardenedRuntime).toBe(true);
  expect(config.osxNotarize).toEqual({ keychainProfile: "amun-test-profile" });
});
