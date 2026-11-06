import { defineConfig } from "vite";
export default defineConfig({
  build: {
    lib: {
      entry: {
        main: "src/main.ts",
        preload: "src/preload.ts",
        service: "src/service.ts",
        "auth-worker": "src/auth-worker.ts",
        "native-pi-worker": "src/native-pi-worker.ts",
      },
      formats: ["cjs"],
      fileName: (_format, name) => `${name}.cjs`,
    },
    outDir: "dist",
    rolldownOptions: {
      external: ["electron", /^node:/],
    },
  },
});
