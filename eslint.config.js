import tseslint from "typescript-eslint";
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/forge.config.cjs",
      "apps/desktop/renderer/renderer.js",
    ],
  },
  ...tseslint.configs.recommended,
);
