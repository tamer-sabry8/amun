import { defineConfig } from "vite";
import { readdir, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
const commit = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
})();
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
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    __AMUN_BUILD__: JSON.stringify({
      version: pkg.version,
      displayVersion: pkg.displayVersion,
      commit,
      builtAt: new Date().toISOString(),
    }),
  },
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
