import { publicMcpFetch } from "./public-mcp-fetch.ts";
const endpoint = "https://docs.mcp.cloudflare.com/mcp";
export const docsFetch = (input: RequestInfo | URL, init?: RequestInit) =>
  publicMcpFetch(endpoint, fetch, input, init);
export async function discoverCloudflareDocs(): Promise<string> {
  const { Client, StreamableHTTPClientTransport } =
    await import("./mcp-client.ts");
  const c = new Client({ name: "amun", version: "0.1.0" });
  try {
    await c.connect(
      new StreamableHTTPClientTransport(new URL(endpoint), {
        fetch: docsFetch,
      }),
    );
    const result = await c.listTools();
    if (!result.tools.some((t) => t.name === "search_cloudflare_documentation"))
      throw Error("Documentation search unavailable");
    return "Cloudflare documentation search is available. Verified anonymously; no Cloudflare account access.";
  } finally {
    await c.close();
  }
}
