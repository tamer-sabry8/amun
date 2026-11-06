import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: [
        "packages/domain/src/**/*.ts",
        "packages/data/src/database.ts",
        "packages/data/src/workspace.ts",
        "packages/data/src/outbox.ts",
        "packages/data/src/audit.ts",
        "packages/data/src/identity.ts",
        "packages/auth/src/**/*.ts",
        "packages/theme/src/**/*.ts",
        "packages/security/src/**/*.ts",
        "apps/desktop/src/preview-navigation.ts",
        "apps/desktop/src/browser.ts",
        "packages/crew/src/observed-run.ts",
        "packages/crew/src/wake-ack.ts",
      ],
      thresholds: {
        "packages/domain/src/**/*.ts": { lines: 90 },
        "packages/data/src/database.ts": { lines: 90 },
        "packages/data/src/outbox.ts": { lines: 90 },
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
