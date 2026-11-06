import { it, expect } from "vitest";
import { ScopedOperation } from "../src/scoped-operation.ts";
it("cancels active work and waits for cleanup before reporting stopped", async () => {
  const scope = new ScopedOperation();
  let cleaned = false;
  const job = scope.run(
    (signal) =>
      new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => {
          setTimeout(() => {
            cleaned = true;
            resolve();
          }, 5);
        }),
      ),
  );
  await scope.close();
  await job;
  expect(cleaned).toBe(true);
  await expect(scope.run(async () => {})).rejects.toThrow();
});
it("refuses overlapping work and permits another operation only after completion", async () => {
  const scope = new ScopedOperation();
  let finish = () => {};
  const job = scope.run(
    () =>
      new Promise<void>((r) => {
        finish = r;
      }),
  );
  await expect(scope.run(async () => {})).rejects.toThrow();
  finish();
  await job;
  expect(await scope.run(async () => "next")).toBe("next");
  await scope.close();
});
