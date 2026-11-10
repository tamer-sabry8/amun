import { _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const binary = resolve(
  `apps/desktop/out/Amun-darwin-${process.arch}/Amun.app/Contents/MacOS/Amun`,
);
const optimizeForSize = process.argv.includes("--optimize-for-size");
const trials: {
  startupMs: number;
  workingSetMiB: number;
  processes: number;
  terminalEchoMs: number;
  processWorkingSets: { type: string; name?: string; workingSetMiB: number }[];
}[] = [];
for (let i = 0; i < 3; i++) {
  const root = await mkdtemp(join(tmpdir(), "amun-m6-performance-"));
  const start = performance.now();
  const app = await electron.launch({
    executablePath: binary,
    args: [
      "--user-data-dir=" + root,
      ...(optimizeForSize ? ["--js-flags=--optimize-for-size"] : []),
    ],
    env: {
      HOME: process.env.HOME!,
      PATH: "/usr/bin:/bin",
      TMPDIR: process.env.TMPDIR!,
    },
    chromiumSandbox: true,
  });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    await page
      .locator("#service-status")
      .filter({ hasText: "Connected" })
      .waitFor();
    const startupMs = Math.round(performance.now() - start);
    const metrics = await app.evaluate(({ app }) =>
      app.getAppMetrics().map((p) => ({
        type: p.type,
        name: p.name,
        workingSetSize: p.memory.workingSetSize,
      })),
    );
    await page.getByRole("button", { name: "Terminal", exact: true }).click();
    await page
      .getByRole("region", { name: "Terminal dock" })
      .filter({ hasText: "readonly" })
      .waitFor();
    await page
      .getByRole("button", { name: "Take control", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Return to read only", exact: true })
      .waitFor();
    await page.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("printf 'PERF_%s\\n' OK");
    const echo = performance.now();
    await page.keyboard.press("Enter");
    await page.locator(".xterm-rows").filter({ hasText: "PERF_OK" }).waitFor();
    trials.push({
      startupMs,
      workingSetMiB: Math.round(
        metrics.reduce((sum, p) => sum + p.workingSetSize, 0) / 1024,
      ),
      processes: metrics.length,
      processWorkingSets: metrics.map((p) => ({
        type: p.type,
        ...(p.name ? { name: p.name } : {}),
        workingSetMiB: Math.round(p.workingSetSize / 1024),
      })),
      terminalEchoMs: Math.round(performance.now() - echo),
    });
  } finally {
    await app.close();
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
}
const allBudgetsMet = trials.every(
  (trial) =>
    trial.startupMs <= 3000 &&
    trial.workingSetMiB <= 500 &&
    trial.terminalEchoMs <= 200,
);
console.log(
  JSON.stringify(
    {
      platform: process.platform,
      arch: process.arch,
      packaged: true,
      mode: optimizeForSize ? "V8 optimize-for-size experiment" : "default",
      trials,
      limitations: [
        "Process-cold launch with warm filesystem caches, not a reboot or clean account",
        "Working set summed across Electron-reported app processes; shared pages may be counted more than once",
        "Terminal echo includes automation scheduling",
        "Other apps remained running",
      ],
      budgets: { startupMs: 3000, workingSetMiB: 500, terminalEchoMs: 200 },
      allBudgetsMet,
      budgetsStatus:
        "M6 packaged full-shell measurements against the T012 budgets",
    },
    null,
    2,
  ),
);
if (!allBudgetsMet) process.exitCode = 1;
