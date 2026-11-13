import { _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Packaged proof of the graphics fallback (apps/desktop/src/graphics-mode.ts).
// One disposable profile is launched repeatedly; an unclean exit is a SIGKILL
// of the main process, which is what an in-process graphics failure amounts to.
// Then a navigation soak checks the in-process mode stays up and smooth.
const binary = resolve(
  `apps/desktop/out/Amun-darwin-${process.arch}/Amun.app/Contents/MacOS/Amun`,
);
const root = await mkdtemp(join(tmpdir(), "amun-graphics-proof-"));
const record = async () =>
  JSON.parse(await readFile(join(root, "graphics-mode.json"), "utf8")) as {
    mode: string;
    running: boolean;
    failures: number;
  };
async function open() {
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
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.locator("#root > *").first().waitFor();
  const types = await app.evaluate(({ app }) =>
    app.getAppMetrics().map((p) => p.type),
  );
  return { app, page, graphicsProcess: types.includes("GPU") };
}
const steps: {
  launch: number;
  expected: string;
  mode: string;
  graphicsProcess: boolean;
  exit: string;
  failuresAfter: number;
}[] = [];
let ok = true;
// launch → expected mode → how it ends
const plan: [string, "clean" | "killed"][] = [
  ["in-process", "clean"],
  ["in-process", "killed"],
  ["separate", "clean"],
  ["in-process", "killed"],
  ["separate", "clean"],
  ["separate", "clean"],
];
try {
  for (const [index, [expected, exit]] of plan.entries()) {
    const { app, graphicsProcess } = await open();
    const during = await record();
    if (exit === "clean") await app.close();
    else {
      const gone = new Promise((done) => app.process().once("exit", done));
      app.process().kill("SIGKILL");
      await gone;
      await app.close().catch(() => undefined);
    }
    const after = await record();
    steps.push({
      launch: index + 1,
      expected,
      mode: during.mode,
      graphicsProcess,
      exit,
      failuresAfter: after.failures,
    });
    if (
      during.mode !== expected ||
      graphicsProcess !== (expected === "separate") ||
      during.running !== true ||
      after.running !== (exit === "killed")
    )
      ok = false;
  }
} finally {
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}

// Soak: in-process graphics through screen changes, resizes and theme switches.
const soakRoot = await mkdtemp(join(tmpdir(), "amun-graphics-soak-"));
let soak: Record<string, unknown> = {};
{
  const app = await electron.launch({
    executablePath: binary,
    args: ["--user-data-dir=" + soakRoot],
    env: {
      HOME: process.env.HOME!,
      PATH: "/usr/bin:/bin",
      TMPDIR: process.env.TMPDIR!,
    },
    chromiumSandbox: true,
  });
  let gone = false;
  app.process().once("exit", () => (gone = true));
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    let rendererCrashes = 0;
    page.on("crash", () => rendererCrashes++);
    for (let step = 0; step < 3; step++)
      await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Finish setup" }).click();
    await page.getByRole("heading", { name: "Welcome to Amun" }).waitFor();
    await page.evaluate(() => {
      const frames: number[] = [];
      let last = performance.now();
      const tick = (now: number) => {
        frames.push(now - last);
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      (window as unknown as { __frames: number[] }).__frames = frames;
    });
    const nav = page.getByRole("navigation", { name: "Amun" });
    const routes = [
      "Agents",
      "Council",
      "Roadmap",
      "Sprints",
      "Portfolio",
      "RFPs",
      "Home",
    ];
    const rounds = Number(process.env.AMUN_SOAK_ROUNDS ?? 40);
    for (let round = 0; round < rounds; round++) {
      for (const name of routes)
        await nav.getByRole("button", { name, exact: true }).click();
      if (round % 4 === 0) {
        const size = round % 8 === 0 ? [900, 620] : [1440, 900];
        await app.evaluate(({ BrowserWindow }, [width, height]) => {
          BrowserWindow.getAllWindows()[0]?.setSize(width!, height!);
        }, size);
      }
      if (round % 10 === 5)
        await app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0];
          window?.minimize();
          window?.restore();
        });
    }
    await page.waitForTimeout(500);
    const frames = await page.evaluate(
      () => (window as unknown as { __frames: number[] }).__frames,
    );
    const sorted = [...frames].sort((a, b) => a - b);
    const metrics = await app.evaluate(({ app }) =>
      app.getAppMetrics().map((p) => ({
        type: p.type,
        workingSetMiB: Math.round(p.memory.workingSetSize / 1024),
      })),
    );
    soak = {
      screenChanges: rounds * routes.length,
      frames: frames.length,
      medianFrameMs:
        Math.round(sorted[Math.floor(sorted.length / 2)]! * 10) / 10,
      p99FrameMs:
        Math.round(sorted[Math.floor(sorted.length * 0.99)]! * 10) / 10,
      framesOver50Ms: frames.filter((f) => f > 50).length,
      rendererCrashes,
      appStillRunning: !gone,
      graphicsProcess: metrics.some((p) => p.type === "GPU"),
      workingSetMiB: metrics.reduce((sum, p) => sum + p.workingSetMiB, 0),
    };
    if (gone || rendererCrashes || soak.graphicsProcess) ok = false;
  } finally {
    await app.close().catch(() => undefined);
    await rm(soakRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
}
console.log(JSON.stringify({ packaged: true, steps, soak, ok }, null, 2));
if (!ok) process.exitCode = 1;
