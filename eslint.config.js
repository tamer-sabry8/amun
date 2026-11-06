import tseslint from "typescript-eslint";
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.runtime/**",
      "**/out/**",
      "**/coverage/**",
      "**/forge.config.cjs",
      "apps/desktop/renderer/renderer.js",
    ],
  },
  ...tseslint.configs.recommended,
);
