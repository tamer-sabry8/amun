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
    extraResource: [".runtime/pi"],
  },
};
