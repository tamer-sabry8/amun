import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: [
        "apps/desktop/src/preview-navigation.ts",
        "apps/desktop/src/browser.ts",
        "packages/crew/src/observed-run.ts",
        "packages/crew/src/wake-ack.ts",
      ],
      thresholds: {
        "apps/desktop/src/browser.ts": { lines: 80 },
        "apps/desktop/src/preview-navigation.ts": { lines: 95, branches: 90 },
        "packages/crew/src/observed-run.ts": { lines: 95, branches: 90 },
        "packages/crew/src/wake-ack.ts": { lines: 95, branches: 90 },
      },
    },
    // Test Amun's owned suites, not tests inside staged third-party distributions.
    include: ["packages/*/tests/**/*.test.ts", "apps/*/tests/**/*.test.ts"],
  },
});
