import { execFileSync } from "node:child_process";
import { copyFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Same layout the Electron renderer had: index.html, renderer.js and
// renderer.css side by side with brand/, avatars/ and fonts/ (motion.css
// loads ./brand/ram.png relative to the stylesheet).
const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));
const pkg = JSON.parse(await readFile(here("../../package.json"), "utf8")) as {
  version: string;
  displayVersion?: string;
};
const commit = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
})();

export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "amun-copy-index",
      async closeBundle() {
        await copyFile(here("./index.html"), here("./build/index.html"));
      },
    },
  ],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    __AMUN_BUILD__: JSON.stringify({
      version: pkg.version,
      displayVersion: pkg.displayVersion ?? pkg.version,
      commit,
      builtAt: new Date().toISOString(),
    }),
  },
  build: {
    lib: {
      entry: here("./src/main.ts"),
      formats: ["es"],
      fileName: () => "renderer.js",
      cssFileName: "renderer",
    },
    outDir: "build",
    emptyOutDir: true,
  },
});
