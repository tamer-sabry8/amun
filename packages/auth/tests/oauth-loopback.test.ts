import { describe, expect, it } from "vitest";
import { createOAuthLoopback } from "../src/oauth-loopback.ts";

describe("OAuth loopback", () => {
  it("rejects wrong state and issuer without consuming the real callback", async () => {
    const callback = await createOAuthLoopback({
      issuer: "https://mcp.notion.com",
      timeoutMs: 1000,
    });
    try {
      for (const query of [
        "state=wrong&code=secret",
        `state=${callback.state}&code=secret&iss=https://evil.test`,
        `state=${callback.state}&state=${callback.state}&code=secret`,
      ]) {
        expect((await fetch(`${callback.url}?${query}`)).status).toBe(400);
      }
      const response = await fetch(
        `${callback.url}?state=${callback.state}&code=private-code&iss=https://mcp.notion.com`,
      );
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain("private-code");
      expect(await callback.code).toBe("private-code");
    } finally {
      callback.close();
    }
  });
  it("rejects POST, wrong path and Host", async () => {
    const callback = await createOAuthLoopback({
      issuer: "https://mcp.notion.com",
      timeoutMs: 1000,
    });
    const ended = callback.code.catch(() => "cancelled");
    try {
      expect((await fetch(callback.url, { method: "POST" })).status).toBe(400);
      expect(
        (await fetch(callback.url.replace("/callback", "/other"))).status,
      ).toBe(400);
      expect(
        (await fetch(callback.url, { headers: { Host: "evil.test" } })).status,
      ).toBe(400);
    } finally {
      callback.close();
    }
    expect(await ended).toBe("cancelled");
  });
  it("expires and supports cancellation without leaking provider errors", async () => {
    const callback = await createOAuthLoopback({
      issuer: "https://mcp.notion.com",
      timeoutMs: 20,
    });
    await expect(callback.code).rejects.toThrow("Sign-in expired");
    const cancelled = await createOAuthLoopback({
      issuer: "https://mcp.notion.com",
      timeoutMs: 1000,
    });
    const rejection = expect(cancelled.code).rejects.toThrow(
      "Sign-in cancelled",
    );
    await fetch(
      `${cancelled.url}?state=${cancelled.state}&error=secret-provider-detail&iss=https://mcp.notion.com`,
    );
    await rejection;
  });
});
it("rejects invalid listener settings before binding", async () => {
  await expect(
    createOAuthLoopback({ issuer: "http://mcp.notion.com" }),
  ).rejects.toThrow();
  await expect(
    createOAuthLoopback({ issuer: "https://mcp.notion.com", port: 65536 }),
  ).rejects.toThrow();
  await expect(
    createOAuthLoopback({ issuer: "https://mcp.notion.com", timeoutMs: 0 }),
  ).rejects.toThrow();
});
