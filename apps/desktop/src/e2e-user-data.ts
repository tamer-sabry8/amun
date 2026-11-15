/** Test-only profile redirect: unpackaged runs with no explicit switch may use AMUN_E2E_USER_DATA. */
export function e2eUserData(input: {
  isPackaged: boolean;
  env: Record<string, string | undefined>;
  hasUserDataSwitch: boolean;
}): string | undefined {
  if (input.isPackaged || input.hasUserDataSwitch) return undefined;
  return input.env.AMUN_E2E_USER_DATA || undefined;
}
