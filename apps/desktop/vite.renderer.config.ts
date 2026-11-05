import { defineConfig } from "vite";
export default defineConfig({
  build: {
    lib: {
      entry: "../renderer/src/main.ts",
      formats: ["iife"],
      name: "AmunRenderer",
      fileName: () => "renderer.js",
    },
    outDir: "renderer",
    emptyOutDir: false,
  },
});
