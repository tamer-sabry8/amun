# T057 release prerequisites

## Owner revision: trusted tester beta

On 10 November the owner requested an ad-hoc-signed R1 beta DMG for trusted testers, Apple-chip Mac launch verification, cleanup for a fresh local installation and an R2 handoff. Developer ID signing and notarization are explicitly deferred to the final step of R2. The earlier missing-certificate prerequisite below is therefore a future R001 release condition, not a blocker on beta packaging. The 500 MiB budget is unchanged.

An explicit beta mode now selects only the ad-hoc identity and never requests notarization. It cannot be combined with the Developer ID release mode. These two configuration regressions were observed failing before implementation and passing afterward; all five signing-mode configuration tests passed. `pnpm beta:mac` builds the pinned-runtime package, verifies its ad-hoc signature and stable app identifier, and creates/verifies an arm64 DMG with an Applications shortcut, beta information and an artifact receipt. DMG copy-out launch verification is still pending at this checkpoint.

The first ad-hoc beta used hardened runtime and failed before application code ran: DYLD rejected the Electron framework because non-platform ad-hoc code has no matching Developer Team ID. The owner supplied the same 06:17:24 crash report generated during acceptance. Only the bounded cause is recorded here; personal crash/device identifiers are excluded.

The beta configuration regression was observed failing with hardened runtime enabled, then passing with it disabled specifically for ad-hoc beta mode. The Developer ID release test still requires hardened runtime enabled. Re-signing with the corrected beta configuration produced `Signature=adhoc`, `Identifier=ai.amun.desktop`, no TeamIdentifier and flags `0x2(adhoc)`. Deep/strict signature verification and the inline app-identifier requirement passed. The separate inline codesign requirement syntax was corrected to begin with `=` after an actual command refused the earlier expression.

The corrected package then launched successfully in three fresh Mac profiles on macOS 27.2 arm64 and verified service connection, terminal control and echo. Startup was 2,261 / 429 / 394 ms. [The full performance receipt](../T056/ad-hoc-beta-full-shell.json) also records the still-failing memory budget. The beta is being rebuilt from the corrected source before its DMG is delivered.

## Earlier release preparation

The development Mac package has an ad-hoc signature, identifier Electron and no TeamIdentifier. The available code-signing identity query returned zero valid identities.

A Developer ID signing identity and notarization credential profile are required to produce and verify the requested signed, notarized DMG. Clean-account installation remains open. T057 remains incomplete. Credentials belong in the Mac's protected storage.

The rebuilt development package passed its pinned Pi RPC and Firstmate owner/permission checks and its packaged regression suite on the Mac. The suite reported 55 passed and 21 conditional skips in 7.1 minutes. Installed prerequisite discovery found Codex CLI 0.163.0, Claude Code 2.1.319 and tmux 3.8. These version results establish executable discovery. The live Codex delivery and same-process reattachment evidence are in T054.

The packaged app and helper bundle identifiers were verified as ai.amun.desktop and ai.amun.desktop.helper. The normal app-owned Keychain persistence test passed across repeated reads, credential replacement and two full app restarts. The release gate must repeat it with the signed installation and preserve those designated application identities, so a product update does not create another credential-access identity.

On 10 November the code-signing identity query again returned zero valid identities. The new reviewed-action recovery and focused packaged acceptance are recorded in T054. Developer ID signing and notarization setup remain owner prerequisites.

Release preparation now includes an explicit `pnpm release:mac` path. Its Forge configuration requires a selected Developer ID Application identity and a local notarytool Keychain profile, enables hardened runtime and uses protected-profile notarization. Three configuration tests were observed red/green: ordinary development builds remain unsigned; incomplete release setup is rejected; the selected identity/profile and stable app identifier are retained. The full unit suite passed 513 tests after this addition.

The release script preflights the installed identity and protected profile, builds pinned resources, verifies the signed/notarized app, creates/signs/notarizes/staples a DMG and emits an artifact hash receipt. This real signing path remains unverified until the owner's certificate and profile are available. [Release and clean-account procedure](../../RELEASE-MAC.md). No signed DMG or clean-account pass is claimed.

The actual release command was invoked without signing inputs and refused before runtime staging or notarization. The Mac still reported zero valid signing identities; notarytool itself is installed. No credential values were inspected.

Installed prerequisite discovery on 10 November found Codex CLI 0.163.0, Claude Code 2.1.321 and tmux 3.8. Claude had updated since the earlier 2.1.319 record. The existing isolated Amun-profile inference probe completed with the exact expected response using tools disabled and session persistence disabled. [Sanitized inference receipt](claude-2.1.321-inference.json). Personal worker sessions were not restarted.
