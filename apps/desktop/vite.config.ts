import { builtinModules } from "node:module";
import { defineConfig } from "vite";
export default defineConfig({
  build: {
    lib: {
      entry: {
        main: "src/main.ts",
        service: "src/service.ts",
        "auth-worker": "src/auth-worker.ts",
        "native-pi-worker": "src/native-pi-worker.ts",
        "worker-login-helper": "../../scripts/worker-login.ts",
      },
      formats: ["cjs"],
      fileName: (_format, name) => `${name}.cjs`,
    },
    outDir: "dist",
    rolldownOptions: {
      external: ["electron", ...builtinModules, /^node:/],
    },
  },
});
