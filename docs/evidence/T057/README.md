# T057 release prerequisites

The current Mac package has an ad-hoc signature, identifier Electron and no TeamIdentifier. The available code-signing identity query returned zero valid identities. Forge currently packages the app and its pinned production runtime resources without Developer ID signing or notarization configuration.

A Developer ID signing identity and notarization credential profile are required to produce and verify the requested signed, notarized DMG. Clean-account installation remains open. T057 remains incomplete. Credentials belong in the Mac's protected storage.

The rebuilt development package passed its pinned Pi RPC and Firstmate owner/permission checks and its packaged regression suite on the Mac. The suite reported 55 passed and 21 conditional skips in 7.1 minutes. Installed prerequisite discovery found Codex CLI 0.163.0, Claude Code 2.1.319 and tmux 3.8. These version results establish executable discovery. The live Codex delivery and same-process reattachment evidence are in T054.

The packaged app and helper bundle identifiers were verified as ai.amun.desktop and ai.amun.desktop.helper. The normal app-owned Keychain persistence test passed across repeated reads, credential replacement and two full app restarts. The release gate must repeat it with the signed installation and preserve those designated application identities, so a product update does not create another credential-access identity.

On 10 November the code-signing identity query again returned zero valid identities. The new reviewed-action recovery and focused packaged acceptance are recorded in T054. Developer ID signing and notarization setup remain owner prerequisites.
