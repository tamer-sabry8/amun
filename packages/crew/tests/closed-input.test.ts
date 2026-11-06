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
