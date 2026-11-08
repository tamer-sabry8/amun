import { expect, it, vi } from "vitest";
import {
  googleMcpProduct,
  googleDiscoveryFetch,
} from "../src/google-workspace-mcp.ts";
it("recognizes only the selected Google product servers", () => {
  expect(googleMcpProduct("gmail")?.endpoint).toBe(
    "https://gmailmcp.googleapis.com/mcp/v1",
  );
  expect(googleMcpProduct("drive")?.tool).toBe("get_file_metadata");
  expect(googleMcpProduct("calendar")?.tool).toBe("list_events");
  expect(googleMcpProduct("sheets")).toEqual({
    id: "sheets",
    label: "Google Sheets",
    endpoint: "https://sheetsmcp.googleapis.com/mcp/v1",
    tool: "get_spreadsheet",
  });
  expect(googleMcpProduct("maps")).toMatchObject({
    endpoint: "https://mapstools.googleapis.com/mcp",
    tool: "search_places",
  });
  for (const key of ["docker", "__proto__", "https://example.org"])
    expect(googleMcpProduct(key)).toBeUndefined();
});
it.each([
  ["docs", "docsmcp", "read_doc"],
  ["slides", "slidesmcp", "read_presentation"],
  ["chat", "chatmcp", "list_messages"],
  ["people", "people", "search_contacts"],
])("routes %s to its official product server", (key, host, tool) => {
  expect(googleMcpProduct(key)).toMatchObject({
    endpoint: "https://" + host + ".googleapis.com/mcp/v1",
    tool,
  });
});
it("binds anonymous discovery to the selected origin and strips ambient authority", async () => {
  const target = googleMcpProduct("gmail")!,
    send = vi.fn(async () => new Response("{}"));
  const request = googleDiscoveryFetch(target, send);
  await expect(
    request("https://drivemcp.googleapis.com/mcp/v1"),
  ).rejects.toThrow();
  await expect(
    request(target.endpoint, { headers: { authorization: "Bearer test" } }),
  ).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
  await request(target.endpoint);
  expect(send).toHaveBeenCalledWith(
    target.endpoint,
    expect.objectContaining({ redirect: "error", credentials: "omit" }),
  );
});
