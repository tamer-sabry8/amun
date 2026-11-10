# Mac release procedure

## R1 trusted tester beta

The owner revised distribution on 10 November: use an ad-hoc-signed arm64 beta for trusted testers. Developer ID signing and notarization are the final step of R2 (R001). The 500 MiB budget is unchanged.

Run `pnpm beta:mac` after verifying the staged pinned runtime. This explicit mode selects the ad-hoc identity, verifies the app signature and bundle identifier, creates a DMG with an Applications shortcut and beta information, verifies the image and writes an artifact/hash receipt under `../releases`. It cannot be combined with Developer ID release mode. Copy the app out of that exact DMG into a disposable installation directory and verify launch/terminal/security/runtime behavior before handing it to the owner. Record actual hardware/OS; do not infer Intel or all-macOS support. Archive earlier local app data for a fresh owner installation while preserving source and evidence.

## Developer ID release — final R2 step

Release acceptance remains gated on T056, T057 and product-owner sign-off in T058. A development package is not a release artifact.

Install the owner's Developer ID Application certificate and private key locally. Store notarization credentials with Apple's interactive `xcrun notarytool store-credentials` flow. Do not put passwords, API keys or certificate exports in the repository, shell history or evidence. Only the identity's public name and the Keychain profile name are build inputs.

With Node and pnpm on PATH, run from the repository root:

```sh
AMUN_SIGN_IDENTITY='Developer ID Application: <owner name> (<team ID>)' \
AMUN_NOTARY_PROFILE='<local profile name>' pnpm release:mac
```

The command refuses missing release configuration or an identity not installed as valid. It validates the local notarization profile before staging the pinned runtime, signs and notarizes the app through Forge, verifies the app's signature, team, bundle identifier, stapled ticket and Gatekeeper assessment, then creates a compressed DMG containing Amun and an Applications shortcut. It signs, submits and staples the DMG, verifies it and records a SHA-256 receipt beside the artifact under `apps/desktop/out/`. Existing artifact names are not overwritten. The signed release path has not yet been exercised with a real certificate.

Forge configuration follows the official [macOS signing guide](https://www.electronforge.io/guides/code-signing/code-signing-macos). Notarization uses a protected [Keychain profile](https://packages.electronjs.org/notarize/main/index.html#usage-with-keychain-credentials). Keep Electron's default per-component entitlements; hardened runtime stays enabled. Native components inside the runtime must pass deep, strict signature verification.

After the artifact passes, use a separate clean macOS account to mount the DMG, copy Amun to Applications and launch it normally. Verify pinned Pi RPC, Firstmate worktree provisioning, supported Codex/Claude/tmux discovery, terminal echo, product isolation and ordinary keyboard navigation. Run app-owned synthetic Keychain acceptance across repeated reads, credential rotation and two restarts. Recheck designated application identity across an installed update. Record any actual macOS prompt; do not treat the ad-hoc development test as proof of signed-update credential access.

Record sanitized artifact hash, Apple submission ID/status, team and bundle identities, Gatekeeper/stapler results, account-isolation conditions and acceptance results under T057. Do not create a macOS account or change the owner's Apple Developer enrollment as part of the build. No public upload is part of this command.
