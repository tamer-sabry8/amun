/**
 * Test-only environment (providers, profile, hidden windows) is honoured when the
 * app is unpackaged, or when a packaged build is launched with BOTH explicit
 * proof switches. Normal launches never carry them.
 */
export function e2eRouteOpen(input: {
  isPackaged: boolean;
  hasProofSwitch: boolean;
  hasTestProvidersSwitch: boolean;
}): boolean {
  return (
    !input.isPackaged || (input.hasProofSwitch && input.hasTestProvidersSwitch)
  );
}

/** Test-only profile redirect: used when no explicit --user-data-dir is given and the test route is open. */
export function e2eUserData(input: {
  isPackaged: boolean;
  env: Record<string, string | undefined>;
  hasUserDataSwitch: boolean;
  hasProofSwitch?: boolean;
  hasTestProvidersSwitch?: boolean;
}): string | undefined {
  if (
    !e2eRouteOpen({
      isPackaged: input.isPackaged,
      hasProofSwitch: input.hasProofSwitch ?? false,
      hasTestProvidersSwitch: input.hasTestProvidersSwitch ?? false,
    }) ||
    input.hasUserDataSwitch
  )
    return undefined;
  return input.env.AMUN_E2E_USER_DATA || undefined;
}
