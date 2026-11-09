import tseslint from "typescript-eslint";
export default tseslint.config(
  {
    ignores: [
      ".remember/**",
      "**/dist/**",
      "**/.runtime/**",
      "**/out/**",
      "**/coverage/**",
      "**/forge.config.cjs",
      "apps/desktop/renderer/renderer.js",
      "apps/desktop/renderer/diff-worker.js",
    ],
  },
  ...tseslint.configs.recommended,
);
