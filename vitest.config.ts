import { defineConfig } from "vitest/config";
// Amun-owned suites only. Paseo packages run their own suites (npm run test:server).
export default defineConfig({
  test: {
    include: [
      "packages/contracts/tests/**/*.test.ts",
      "packages/domain/tests/**/*.test.ts",
      "packages/work-store/tests/**/*.test.ts",
      "packages/council/tests/**/*.test.ts",
      "packages/notion/tests/**/*.test.ts",
      "packages/theme/tests/**/*.test.ts",
      "packages/amun-ui/tests/**/*.test.ts",
      "packages/server/src/server/amun/**/*.test.ts",
      // Amun's own additions to the desktop shell.
      "packages/desktop/src/features/amun-browser/**/*.test.ts",
      "packages/desktop/src/preload-sandbox.test.ts",
      "packages/desktop/src/amun-shell-env-cache.test.ts",
      "packages/desktop/scripts/check-adhoc-signing.test.mjs",
    ],
  },
});
