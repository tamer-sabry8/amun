import { builtinModules } from "node:module";
import { defineConfig } from "vite";
// A standalone entry prevents service-only shared chunks being evaluated in main.
export default defineConfig({
  build: {
    lib: {
      entry: "src/main.ts",
      formats: ["cjs"],
      fileName: () => "main.cjs",
    },
    outDir: "dist",
    emptyOutDir: false,
    rolldownOptions: { external: ["electron", ...builtinModules, /^node:/] },
  },
});
