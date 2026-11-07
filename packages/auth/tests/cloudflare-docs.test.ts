import { it, expect } from "vitest";
import { docsFetch } from "../src/cloudflare-docs.ts";
it("rejects off-origin, query, alternate path and auth headers before network I/O", async () => {
  for (const target of [
    "https://example.org/mcp",
    "https://docs.mcp.cloudflare.com/mcp?token=oops",
    "https://docs.mcp.cloudflare.com/sse",
  ]) {
    await expect(docsFetch(target)).rejects.toThrow("Unsafe");
  }
  await expect(
    docsFetch("https://docs.mcp.cloudflare.com/mcp", {
      headers: { Authorization: "Bearer fixture" },
    }),
  ).rejects.toThrow("Unsafe");
});
