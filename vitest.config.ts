import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    // Test Amun's owned suites, not tests inside staged third-party distributions.
    include: ["packages/*/tests/**/*.test.ts", "apps/*/tests/**/*.test.ts"],
  },
});
