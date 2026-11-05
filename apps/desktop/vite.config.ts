import { defineConfig } from "vite";
export default defineConfig({
  build: {
    lib: { entry: "src/main.ts", formats: ["cjs"], fileName: () => "main.cjs" },
    outDir: "dist",
    rolldownOptions: { external: ["electron", "node:path"] },
  },
});
