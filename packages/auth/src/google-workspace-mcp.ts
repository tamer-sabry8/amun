import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { publicMcpFetch } from "./public-mcp-fetch.ts";
const products = [
  {
    id: "gmail",
    label: "Gmail",
    endpoint: "https://gmailmcp.googleapis.com/mcp/v1",
    tool: "get_message",
  },
  {
    id: "drive",
    label: "Google Drive",
    endpoint: "https://drivemcp.googleapis.com/mcp/v1",
    tool: "get_file_metadata",
  },
  {
    id: "calendar",
    label: "Google Calendar",
    endpoint: "https://calendarmcp.googleapis.com/mcp/v1",
    tool: "list_events",
  },
] as const;
type Product = (typeof products)[number];
export function googleMcpProduct(key: string) {
  return products.find((p) => p.id === key);
}
export function googleDiscoveryFetch(
  product: Product,
  send: typeof fetch = fetch,
) {
  return (input: RequestInfo | URL, init?: RequestInit) =>
    publicMcpFetch(product.endpoint, send, input, init);
}
export async function discoverGoogleMcp(product: Product) {
  const client = new Client({ name: "amun", version: "0.1.0" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(product.endpoint), {
        fetch: googleDiscoveryFetch(product),
      }),
    );
    const list = await client.listTools();
    if (!list.tools.some((t) => t.name === product.tool))
      throw Error("Expected product tool unavailable");
    return (
      product.label +
      " MCP tools verified. Access to your account still requires Google authorization."
    );
  } finally {
    await client.close();
  }
}
