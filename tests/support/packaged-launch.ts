import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Explicit, test-only packaged route: the packaged app honours the e2e provider,
 * profile and window variables only when launched with both switches. Specs add
 * them only when AMUN_PACKAGED_PATH is set; a normal launch never carries them.
 */
export function packagedTestSwitches(): string[] {
  return process.env.AMUN_PACKAGED_PATH
    ? ["--amun-proof", "--amun-e2e-test-providers"]
    : [];
}

/** Packaged proof-page specs ignore AMUN_E2E_USER_DATA, so they get their own throwaway profile. */
export function packagedProofProfile(): string[] {
  return process.env.AMUN_PACKAGED_PATH
    ? ["--user-data-dir=" + mkdtempSync(join(tmpdir(), "amun-proof-profile-"))]
    : [];
}
