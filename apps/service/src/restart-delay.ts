export function restartDelay(attempt: number): number {
  if (!Number.isSafeInteger(attempt) || attempt < 0)
    throw new RangeError("Invalid restart attempt");
  return Math.min(100 * 2 ** Math.min(attempt, 5), 2000);
}
