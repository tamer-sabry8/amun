import { defineConfig } from "@playwright/test";
// The suites written for the earlier shell keep driving it; the rebuilt shell's
// own suite opts back in (tests/e2e/rebuild-shell.spec.ts). See docs/UX-REBUILD.md.
process.env.AMUN_LEGACY_SHELL ??= "1";
export default defineConfig({ testDir: "./tests/e2e", workers: 1, retries: 0 });
