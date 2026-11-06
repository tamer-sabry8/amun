module.exports = {
  packagerConfig: {
    asar: true,
    appBundleId: "ai.amun.desktop",
    // App code is bundled; ship only the separately staged production runtime.
    prune: false,
    ignore: [
      /^\/node_modules(?:\/|$)/,
      /^\/\.runtime(?:\/|$)/,
      /^\/src(?:\/|$)/,
      /^\/tests(?:\/|$)/,
    ],
    extraResource: [".runtime/pi", ".runtime/firstmate"],
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
          join(__dirname, ".runtime/pi"),
          join(resources, "pi"),
        );
        await repairRuntimeLinks(
          join(__dirname, ".runtime/firstmate"),
          join(resources, "firstmate"),
        );
      },
    ],
  },
};
