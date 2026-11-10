import { defineConfig } from "vite";
import { readdir, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const rendererDirectory = fileURLToPath(
  new URL("./renderer/", import.meta.url),
);
export default defineConfig({
  plugins: [
    {
      name: "amun-clean-generated-renderer",
      async buildStart() {
        // Preserve the checked-in HTML and fonts while dropping obsolete hashed chunks.
        for (const file of await readdir(rendererDirectory, {
          withFileTypes: true,
        })) {
          if (
            file.isFile() &&
            (file.name.endsWith(".js") || file.name === "renderer.css")
          )
            await unlink(join(rendererDirectory, file.name));
        }
      },
    },
  ],
  base: "./",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    lib: {
      entry: "../renderer/src/main.ts",
      formats: ["es"],
      fileName: () => "renderer.js",
      cssFileName: "renderer",
    },
    outDir: "renderer",
    emptyOutDir: false,
  },
});
