const release = process.env.AMUN_RELEASE === "1";
const beta = process.env.AMUN_BETA === "1";
if (release && beta)
  throw Error(
    "Signed release and trusted tester beta modes are mutually exclusive",
  );
const identity = process.env.AMUN_SIGN_IDENTITY?.trim();
const profile = process.env.AMUN_NOTARY_PROFILE?.trim();
if (
  release &&
  !/^Developer ID Application: .+ \([A-Z0-9]{10}\)$/.test(identity ?? "")
)
  throw Error(
    "Release requires AMUN_SIGN_IDENTITY with a Developer ID Application identity",
  );
if (release && (!profile || /[\0\r\n]/.test(profile)))
  throw Error(
    "Release requires AMUN_NOTARY_PROFILE naming a local notarytool Keychain profile",
  );

module.exports = {
  packagerConfig: {
    asar: true,
    download: { checksums: require("electron/checksums.json") },
    appBundleId: "ai.amun.desktop",
    ...(release
      ? {
          osxSign: {
            identity,
            optionsForFile: () => ({ hardenedRuntime: true }),
          },
          osxNotarize: { keychainProfile: profile },
        }
      : beta
        ? {
            osxSign: {
              identity: "-",
              identityValidation: false,
              // Ad-hoc code has no Team ID for hardened library validation.
              // Developer ID release mode above retains hardened runtime.
              optionsForFile: () => ({ hardenedRuntime: false }),
            },
          }
        : {}),
    // App code is bundled; ship only the separately staged production runtime.
    prune: false,
    ignore: [
      /^\/out(?:\/|$)/,
      /^\/node_modules(?:\/|$)/,
      /^\/\.runtime(?:\/|$)/,
      /^\/src(?:\/|$)/,
      /^\/tests(?:\/|$)/,
    ],
    extraResource: [
      ".runtime/pi",
      ".runtime/firstmate",
      ".runtime/firstmate-archives",
      ".runtime/terminal",
      ".runtime/database",
      ".runtime/auth",
      ".runtime/mcp",
    ],
    afterCopyExtraResources: [
      async ({ buildPath, platform }) => {
        const { join } = require("node:path");
        const { repairRuntimeLinks } =
          await import("../../packages/crew/src/runtime-links.ts");
        const resources =
          platform === "darwin"
            ? join(buildPath, "Amun.app/Contents/Resources")
            : join(buildPath, "resources");
        await repairRuntimeLinks(
          join(__dirname, ".runtime/mcp"),
          join(resources, "mcp"),
        );
        await repairRuntimeLinks(
          join(__dirname, ".runtime/auth"),
          join(resources, "auth"),
        );
        await repairRuntimeLinks(
          join(__dirname, ".runtime/database"),
          join(resources, "database"),
        );
        await repairRuntimeLinks(
          join(__dirname, ".runtime/pi"),
          join(resources, "pi"),
        );
        await repairRuntimeLinks(
          join(__dirname, ".runtime/terminal"),
          join(resources, "terminal"),
        );
        await repairRuntimeLinks(
          join(__dirname, ".runtime/firstmate"),
          join(resources, "firstmate"),
        );
      },
    ],
  },
};
