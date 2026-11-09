import { defineConfig } from "vite";
import { createRequire } from "node:module";
const renderer = createRequire(
  new URL("../renderer/package.json", import.meta.url),
);
export default defineConfig({
  build: {
    lib: {
      entry: renderer.resolve("monaco-editor/editor/editor.worker.js"),
      formats: ["iife"],
      name: "MonacoDiffWorker",
      fileName: () => "diff-worker.js",
    },
    outDir: "renderer",
    emptyOutDir: false,
  },
});
