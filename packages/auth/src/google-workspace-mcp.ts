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
  {
    id: "sheets",
    label: "Google Sheets",
    endpoint: "https://sheetsmcp.googleapis.com/mcp/v1",
    tool: "get_spreadsheet",
  },
  {
    id: "maps",
    label: "Google Maps",
    endpoint: "https://mapstools.googleapis.com/mcp",
    tool: "search_places",
  },
  {
    id: "docs",
    label: "Google Docs",
    endpoint: "https://docsmcp.googleapis.com/mcp/v1",
    tool: "read_doc",
  },
  {
    id: "slides",
    label: "Google Slides",
    endpoint: "https://slidesmcp.googleapis.com/mcp/v1",
    tool: "read_presentation",
  },
  {
    id: "chat",
    label: "Google Chat",
    endpoint: "https://chatmcp.googleapis.com/mcp/v1",
    tool: "list_messages",
  },
  {
    id: "people",
    label: "Google People / Contacts",
    endpoint: "https://people.googleapis.com/mcp/v1",
    tool: "search_contacts",
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
  const { Client, StreamableHTTPClientTransport } =
    await import("./mcp-client.ts");
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
    if (product.id === "maps")
      return "Google Maps MCP tools verified. Place searches require a configured Google Maps project and credentials.";
    return (
      product.label +
      " MCP tools verified. Access to your account still requires Google authorization."
    );
  } finally {
    await client.close();
  }
}
