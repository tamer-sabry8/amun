import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
const errorResult = z.object({
  structuredContent: z.object({
    error: z.object({
      code: z.literal("rate_limited"),
      retry_after_seconds: z.unknown().optional(),
    }),
  }),
});
export async function notionRead<T>(
  name: string,
  call: () => Promise<T>,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<T> {
  if (name !== "notion-fetch" && name !== "notion-get-self")
    throw Error("Unsupported Notion read");
  for (let attempt = 0; ; attempt++) {
    const result = await call();
    const limited = errorResult.safeParse(result);
    if (!limited.success) return result;
    const value = limited.data.structuredContent.error.retry_after_seconds;
    const delay = value === undefined ? 2 : value;
    if (
      attempt ||
      typeof delay !== "number" ||
      !Number.isFinite(delay) ||
      delay < 0 ||
      delay > 2
    )
      throw Error("Notion is rate-limiting this read. Try again later.");
    await wait(Math.ceil(delay * 1000));
  }
}
