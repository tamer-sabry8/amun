import { expect, it, vi } from "vitest";
import { notionRead } from "../src/notion-read-backoff.ts";
const limited = (seconds: unknown) => ({
  isError: true,
  structuredContent: {
    error: { code: "rate_limited", retry_after_seconds: seconds },
  },
});
it("honours a short server delay once for classified reads only", async () => {
  const call = vi
      .fn()
      .mockResolvedValueOnce(limited(0.5))
      .mockResolvedValue("ok"),
    wait = vi.fn().mockResolvedValue(undefined);
  expect(await notionRead("notion-fetch", call, wait)).toBe("ok");
  expect(wait).toHaveBeenCalledWith(500);
  expect(call).toHaveBeenCalledTimes(2);
  await expect(notionRead("notion-create-pages", call, wait)).rejects.toThrow();
  expect(call).toHaveBeenCalledTimes(2);
});
it("never shortens a long delay, loops, or retries transport failures", async () => {
  const wait = vi.fn().mockResolvedValue(undefined);
  for (const delay of [120, -1, "3", Infinity]) {
    const call = vi.fn().mockResolvedValue(limited(delay));
    await expect(notionRead("notion-get-self", call, wait)).rejects.toThrow();
    expect(call).toHaveBeenCalledOnce();
  }
  const call = vi.fn().mockResolvedValue(limited(1));
  await expect(notionRead("notion-fetch", call, wait)).rejects.toThrow();
  expect(call).toHaveBeenCalledTimes(2);
  const offline = vi.fn().mockRejectedValue(Error("offline"));
  await expect(notionRead("notion-fetch", offline, wait)).rejects.toThrow();
  expect(offline).toHaveBeenCalledOnce();
});
