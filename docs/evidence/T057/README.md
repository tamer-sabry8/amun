# T057 release prerequisites

The current Mac package has an ad-hoc signature, identifier Electron and no TeamIdentifier. The available code-signing identity query returned zero valid identities. Forge currently packages the app and its pinned production runtime resources without Developer ID signing or notarization configuration.

A Developer ID signing identity and notarization credential profile are required to produce and verify the requested signed, notarized DMG. Clean-account installation remains open. T057 remains incomplete. Credentials belong in the Mac's protected storage.
