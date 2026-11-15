/**
 * The earlier ("legacy") shell is test-only: it exists so the e2e specs that
 * have not been migrated keep running. It must never be reachable in a packaged app.
 */
export function shellQuery(input: {
  isPackaged: boolean;
  hasProofSwitch: boolean;
  hasGallerySwitch: boolean;
  hasLegacySwitch: boolean;
  env: Record<string, string | undefined>;
}): Record<string, string> {
  if (input.hasProofSwitch) return { proof: "1" };
  if (input.isPackaged) return { packaged: "1" };
  if (input.hasGallerySwitch) return { gallery: "1" };
  if (input.hasLegacySwitch || input.env.AMUN_LEGACY_SHELL === "1")
    return { legacy: "1" };
  return {};
}

/** Windows opened by Playwright stay off the owner's screen. */
export function hideWindowsForTests(input: {
  isPackaged: boolean;
  env: Record<string, string | undefined>;
}): boolean {
  if (input.isPackaged) return false;
  return (
    input.env.AMUN_E2E_HIDE_WINDOWS === "1" ||
    Boolean(input.env.AMUN_E2E_TEST_PROVIDERS)
  );
}
