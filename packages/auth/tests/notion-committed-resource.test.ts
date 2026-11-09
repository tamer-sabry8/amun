import { expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NotionConnection } from "../src/notion-connection.ts";

it("uses a 503 committed resource hint once and verifies its parent and reviewed marker through MCP", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-notion-commit-"));
  const parent = "11111111-1111-4111-8111-111111111111",
    page = "22222222-2222-4222-8222-222222222222",
    marker = "33333333-3333-4333-8333-333333333333";
  const text = "Synthetic\n\nAmun publication ID: " + marker;
  const calls: string[] = [];
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const tool = (value: unknown) => ({
    content: [{ type: "text", text: JSON.stringify(value) }],
  });
  const connection = new NotionConnection({
    root,
    workspace: "synthetic",
    keyring: {
      get: () =>
        JSON.stringify({
          redirectUrl: "http://127.0.0.1:34567/callback",
          tokens: {
            access_token: "fixture",
            token_type: "Bearer",
            issuer: "https://mcp.notion.com",
          },
          expiresAt: Date.now() + 3600000,
        }),
      set: vi.fn(),
      delete: vi.fn(),
    },
    registerSecret: vi.fn(),
    open: vi.fn(),
    verify: async () => {},
  });
  const transport = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (_url, init) => {
      if (init?.method !== "POST") return new Response(null, { status: 405 });
      const request = JSON.parse(String(init.body));
      const reply = (result: unknown) =>
        json({ jsonrpc: "2.0", id: request.id, result });
      if (request.method === "initialize")
        return reply({
          protocolVersion: request.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "fixture", version: "1" },
        });
      if (request.method === "notifications/initialized")
        return new Response(null, { status: 202 });
      if (request.method === "tools/list")
        return reply({
          tools: ["notion-get-self", "notion-create-pages", "notion-fetch"].map(
            (name) => ({ name, inputSchema: { type: "object" } }),
          ),
        });
      calls.push(request.params.name);
      if (request.params.name === "notion-get-self")
        return reply(
          tool({
            workspace: { id: parent, name: "Test" },
            user: { type: "bot" },
          }),
        );
      if (request.params.name === "notion-create-pages")
        return json({ committed_resource_id: page }, 503);
      if (request.params.name === "notion-fetch")
        return reply(
          tool({
            id: page,
            url: "https://www.notion.so/" + page,
            metadata: { type: "page" },
            text:
              '<page>\n<ancestor-path>\n<parent-page url="https://www.notion.so/' +
              parent +
              '"/>\n</ancestor-path>\n<content>\n' +
              text +
              "\n</content>\n</page>",
          }),
        );
      throw Error("Unexpected call");
    });
  try {
    const beforeSend = vi.fn();
    expect(
      await connection.publish(
        { parentId: parent, title: "Review", text },
        parent,
        beforeSend,
      ),
    ).toEqual({ state: "created", pageId: page });
    expect(beforeSend).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      "notion-get-self",
      "notion-create-pages",
      "notion-fetch",
    ]);
  } finally {
    transport.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
