# T057 verified trusted tester beta

Status: complete for the owner's revised beta packaging scope. M6's 500 MiB performance gate and the owner's installation feedback remain open separately. Developer ID signing/notarization are R001, the final step of R2.

## Verified artifact

- File: `/Users/tamersabry/Documents/ChatGPT/Amun/releases/Amun-0.1.0-beta-arm64-7eea589.dmg` (426 MiB).
- Source: `7eea589313988756ffe32c378699f413c6c208fd`, clean at build start.
- SHA-256: `2ab47125a20822191c44ff639b337f911015c5c89cb99ef4c4e1aa3a2ffc7a52`.
- Signature: ad-hoc, app identifier `ai.amun.desktop`, no Developer Team ID, not notarized. Developer ID mode still requires hardened runtime; only the explicit ad-hoc beta mode disables it.
- Deep/strict app signature, app-identifier requirement, DMG signature and image integrity passed. The image was mounted read-only, the app copied into a disposable installation directory, its signature verified and its `app.asar` compared byte-for-byte with the packaged source. The test image was detached.
- Corrected beta packaged regression: **57 passed, 23 conditional skips, no failures in 8.1 minutes**, plus pinned Pi RPC and Firstmate owner/permission proofs. Six further tests passed from the DMG copy in 31.3 seconds: shell/restart/themes, drawer timing/focus, PRD import/export, app-owned Keychain persistence across rotation and two restarts, deferred module evaluation and terminal control.
- Normal macOS LaunchServices opened the copied app with a fresh profile on **macOS 27.2 arm64**. Native AX/screenshot inspection verified the rendered Overview, Workspace selector, normal navigation and service **Connected**. The test app was then closed. This verifies this Apple-chip Mac; Intel or every macOS release is not inferred.
- All 515 source unit tests, lint, typecheck and formatting passed. [Hosted macOS CI for the exact beta source](https://github.com/tamer-sabry8/amun/actions/runs/42742690772) completed successfully.

[Sanitized beta receipt](beta-dmg.json). The original receipt remains beside the DMG.

## Fresh-install cleanup

At the owner's request, nine old app-state/development-app paths, 724 temporary Amun directories and 1,568 temporary Amun files were moved into a private, mode-0700 archive at `~/Library/Application Support/Amun-Backups/2026-11-10-before-beta`. Development app bundles were renamed as backups. Three verified Amun-owned tmux servers and two Amun-owned worker processes were stopped. Four identified `ai.amun` credential entries were removed; 75 other identified targets were already absent, with zero failures. No credential values were read or exported.

The active Amun app-data folder was absent after cleanup, ready for the owner's fresh install. The owner may now create new app state; do not repeat cleanup against it. Source/evidence and the DMG were preserved. The canonical checkout remained clean on `main` at `1b0850b30e45c80a552c02e4469309b92886ea83`. Personal Firstmate/Herdr/Pi and CLI profiles were not targeted. Remote TEST branch/PR records and the approved Notion pages remain intact. [Sanitized cleanup receipt](cleanup.json). The complete path manifest stays private in the archive.

The owner's normal installation/product-creation feedback is pending. No clean-account public-release installation or full M6 sign-off is claimed. See the [R2 handoff](../../R1-BETA-TO-R2-HANDOFF.md).

## Earlier checkpoints

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
