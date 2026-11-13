import { _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Packaged memory and startup for the rebuilt shell (shell v3), measured the
// same way as performance-proof.ts: working set summed across the processes
// Electron reports, in a disposable profile. Terminal echo is not measured
// because the rebuilt shell has no Terminal tile.
const binary = resolve(
  `apps/desktop/out/Amun-darwin-${process.arch}/Amun.app/Contents/MacOS/Amun`,
);
type Sample = {
  workingSetMiB: number;
  processes: number;
  processWorkingSets: { type: string; name?: string; workingSetMiB: number }[];
};
const trials: { startupMs: number; setup: Sample; home: Sample }[] = [];
for (let i = 0; i < 3; i++) {
  const root = await mkdtemp(join(tmpdir(), "amun-rebuild-performance-"));
  const start = performance.now();
  const app = await electron.launch({
    executablePath: binary,
    args: ["--user-data-dir=" + root],
    env: {
      HOME: process.env.HOME!,
      PATH: "/usr/bin:/bin",
      TMPDIR: process.env.TMPDIR!,
    },
    chromiumSandbox: true,
  });
  const sample = async (): Promise<Sample> => {
    const metrics = await app.evaluate(({ app }) =>
      app.getAppMetrics().map((p) => ({
        type: p.type,
        name: p.name,
        workingSetSize: p.memory.workingSetSize,
      })),
    );
    return {
      workingSetMiB: Math.round(
        metrics.reduce((sum, p) => sum + p.workingSetSize, 0) / 1024,
      ),
      processes: metrics.length,
      processWorkingSets: metrics.map((p) => ({
        type: p.type,
        ...(p.name ? { name: p.name } : {}),
        workingSetMiB: Math.round(p.workingSetSize / 1024),
      })),
    };
  };
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    // Ready: the first setup step is on screen and the service has answered.
    await page
      .getByRole("heading", { name: "Let’s power Firstmate" })
      .waitFor();
    await page.getByText("ChatGPT Plus/Pro").waitFor();
    const startupMs = Math.round(performance.now() - start);
    const setup = await sample();
    for (let step = 0; step < 3; step++)
      await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Finish setup" }).click();
    await page.getByRole("heading", { name: "Welcome to Amun" }).waitFor();
    await page.waitForTimeout(1500);
    trials.push({ startupMs, setup, home: await sample() });
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
    trial.setup.workingSetMiB <= 500 &&
    trial.home.workingSetMiB <= 500,
);
console.log(
  JSON.stringify(
    {
      platform: process.platform,
      arch: process.arch,
      packaged: true,
      shell: "rebuild (v3)",
      trials,
      limitations: [
        "Process-cold launch with warm filesystem caches, not a reboot or clean account",
        "Working set summed across Electron-reported app processes; shared pages may be counted more than once",
        "No sign-in, no agents running and no Council session",
        "Other apps remained running",
      ],
      budgets: { startupMs: 3000, workingSetMiB: 500 },
      allBudgetsMet,
    },
    null,
    2,
  ),
);
if (!allBudgetsMet) process.exitCode = 1;
