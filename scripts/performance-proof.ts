import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const binary = resolve(
  `apps/desktop/out/Amun-darwin-${process.arch}/Amun.app/Contents/MacOS/Amun`,
);
const trials: {
  startupMs: number;
  workingSetMiB: number;
  processes: number;
  terminalEchoMs: number;
}[] = [];
for (let i = 0; i < 3; i++) {
  const start = performance.now();
  const app = await electron.launch({
    executablePath: binary,
    args: [],
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
    await page.getByRole("status").filter({ hasText: "Connected" }).waitFor();
    const startupMs = Math.round(performance.now() - start);
    const metrics = await app.evaluate(({ app }) =>
      app
        .getAppMetrics()
        .map((p) => ({ workingSetSize: p.memory.workingSetSize })),
    );
    await page
      .getByRole("button", { name: "Open terminal", exact: true })
      .click();
    await page
      .locator("#terminal-status")
      .filter({ hasText: "readonly" })
      .waitFor();
    await page
      .getByRole("button", { name: "Take control", exact: true })
      .click();
    await page
      .locator("#terminal-status")
      .filter({ hasText: "control" })
      .waitFor();
    await page.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("printf 'PERF_%s\\n' OK");
    const echo = performance.now();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() =>
      document
        .getElementById("terminal-output")
        ?.textContent?.includes("PERF_OK"),
    );
    trials.push({
      startupMs,
      workingSetMiB: Math.round(
        metrics.reduce((sum, p) => sum + p.workingSetSize, 0) / 1024,
      ),
      processes: metrics.length,
      terminalEchoMs: Math.round(performance.now() - echo),
    });
  } finally {
    await app.close();
  }
}
console.log(
  JSON.stringify(
    {
      platform: process.platform,
      arch: process.arch,
      packaged: true,
      trials,
      limitations: [
        "Process-cold launch with warm filesystem caches, not a reboot or clean account",
        "Working set summed across Electron-reported app processes; shared pages may be counted more than once",
        "Terminal echo includes automation scheduling; no editor exists yet",
        "Other apps remained running",
      ],
      budgets: { startupMs: 3000, workingSetMiB: 500, terminalEchoMs: 200 },
      budgetsStatus: "provisional engineering baseline; not release acceptance",
    },
    null,
    2,
  ),
);
