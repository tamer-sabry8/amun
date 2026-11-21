import { expect, it, vi } from "vitest";
import { scheduleBlockerChecks } from "./blocker-checks.js";

it("checks open blockers hourly, skips overlapping checks and stops at shutdown", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const check = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const stop = scheduleBlockerChecks(check, vi.fn());
  try {
    await vi.advanceTimersByTimeAsync(3_599_999);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(check).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(check).toHaveBeenCalledTimes(2);
    finish();
    stop();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(check).toHaveBeenCalledTimes(2);
  } finally {
    stop();
    vi.useRealTimers();
  }
});
