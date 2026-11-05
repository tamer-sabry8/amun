import tseslint from "typescript-eslint";
export default tseslint.config(
  { ignores: ["**/dist/**", "**/coverage/**", "**/forge.config.cjs"] },
  ...tseslint.configs.recommended,
);
