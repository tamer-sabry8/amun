import { defineConfig } from "vite";
// Sandboxed preloads cannot require sibling chunks. Keep this build standalone.
export default defineConfig({
  build: {
    lib: {
      entry: "src/preload.ts",
      formats: ["cjs"],
      fileName: () => "preload.cjs",
    },
    outDir: "dist",
    emptyOutDir: false,
    rolldownOptions: { external: ["electron"] },
  },
});
