import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    lib: {
      entry: "../renderer/src/main.ts",
      formats: ["iife"],
      name: "AmunRenderer",
      fileName: () => "renderer.js",
      cssFileName: "renderer",
    },
    outDir: "renderer",
    emptyOutDir: false,
  },
});
