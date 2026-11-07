import { expect, it, vi } from "vitest";
import { probeConnection } from "../src/probe.ts";
import { connectionId } from "../src/broker.ts";

it.each(["https://127.0.0.1:27124/mcp/", "http://127.0.0.1:27123/mcp/"])(
  "verifies the vault read tool through the selected authenticated plugin endpoint %s",
  async (baseUrl) => {
    const calls: string[] = [];
    const send = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe(baseUrl);
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer fixture",
      );
      const body = JSON.parse(String(init?.body));
      calls.push(body.method);
      if (!body.id && body.id !== 0) return new Response(null, { status: 202 });
      const result =
        body.method === "initialize"
          ? {
              protocolVersion: "2025-03-26",
              capabilities: { tools: {} },
              serverInfo: { name: "obsidian", version: "1" },
            }
          : {
              tools: [{ name: "vault_read", inputSchema: { type: "object" } }],
            };
      return Response.json({ jsonrpc: "2.0", id: body.id, result });
    });
    expect(
      await probeConnection({ kind: "obsidian", baseUrl }, "fixture", send),
    ).toBe(true);
    expect(calls).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
    ]);
  },
);
it("rejects other local apps, redirects disguised as paths, and non-loopback addresses before key lookup", () => {
  for (const baseUrl of [
    "http://127.0.0.1:27124/mcp/",
    "https://127.0.0.1:27124/other",
    "https://127.0.0.1:27124/mcp/?next=https://example.org",
    "https://example.org:27124/mcp/",
  ])
    expect(() => connectionId({ kind: "obsidian", baseUrl })).toThrow();
});
