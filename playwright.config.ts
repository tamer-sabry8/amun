import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Specs that launch without --user-data-dir inherit this private profile, never the real one.
process.env.AMUN_E2E_USER_DATA ||= mkdtempSync(
  join(tmpdir(), "amun-e2e-profile-"),
);
// The suites written for the earlier shell keep driving it; the rebuilt shell's
// own suite opts back in (tests/e2e/rebuild-shell.spec.ts). See docs/UX-REBUILD.md.
process.env.AMUN_LEGACY_SHELL ??= "1";
// Explicit test-only declaration of the fixture model providers the specs register;
// without it the app refuses unless GitHub Copilot is connected.
process.env.AMUN_E2E_TEST_PROVIDERS ??= "amun-queue,amun-local";
export default defineConfig({ testDir: "./tests/e2e", workers: 1, retries: 0 });
