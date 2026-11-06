import { it, expect } from "vitest";
import { runClosedInput } from "../src/closed-input.ts";
it("closes unused stdin so a noninteractive worker can finish", async () => {
  const result = await runClosedInput(
    process.execPath,
    [
      "-e",
      "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('completed'))",
    ],
    { cwd: process.cwd(), env: {}, timeout: 2000, maxBuffer: 1024 },
  );
  expect(result.stdout).toBe("completed");
});
it("rejects unsuccessful, oversized and stalled runs without leaking raw output", async () => {
  for (const code of [
    "process.stderr.write('secret');process.exit(1)",
    "process.stdout.write('x'.repeat(4096))",
    "setInterval(()=>{},100)",
  ]) {
    await expect(
      runClosedInput(process.execPath, ["-e", code], {
        cwd: process.cwd(),
        env: {},
        timeout: 100,
        maxBuffer: 1024,
      }),
    ).rejects.toThrow("Worker command failed");
  }
});
it("waits for child teardown after cancellation instead of rejecting at the abort event", async () => {
  const { mkdtemp, readFile, rm, access } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const root = await mkdtemp(join(tmpdir(), "amun-cli-cancel-")),
    marker = join(root, "running");
  const controller = new AbortController();
  const result = runClosedInput(
    process.execPath,
    [
      "-e",
      "const fs=require('node:fs');fs.writeFileSync(process.argv[1],'ready');process.on('SIGTERM',()=>setTimeout(()=>{fs.unlinkSync(process.argv[1]);process.exit(0)},100));setInterval(()=>{},1000)",
      marker,
    ],
    {
      cwd: root,
      env: {},
      timeout: 3000,
      maxBuffer: 1024,
      signal: controller.signal,
    },
  ).catch(() => "cancelled");
  try {
    for (let i = 0; i < 100; i++) {
      if ((await readFile(marker, "utf8").catch(() => "")) === "ready") break;
      await new Promise((r) => setTimeout(r, 10));
    }
    controller.abort();
    expect(await result).toBe("cancelled");
    await expect(access(marker)).rejects.toThrow();
  } finally {
    await new Promise((r) => setTimeout(r, 150));
    await rm(root, { recursive: true, force: true });
  }
});
