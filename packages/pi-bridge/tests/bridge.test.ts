import { expect, it, vi } from "vitest";
import { gateTool } from "../src/gate.ts";
const id = "b644a437-b095-403c-9c21-6628b16b2bcf";
it("blocks direct, nested, unknown and self-declared read-only calls before execution", async () => {
  const propose = vi.fn(async () => id);
  for (const event of [
    { toolName: "mcp_write", annotations: { readOnlyHint: true } },
    { toolName: "mcp_write", parentToolCallId: "code/1" },
    { toolName: "codemode" },
    { toolName: "unknown" },
  ]) {
    expect(await gateTool(event, propose)).toEqual({
      block: true,
      reason: "Pending Amun review: " + id,
    });
  }
  expect(propose).toHaveBeenCalledTimes(4);
});
it("blocks on service failure, invalid tool or invalid receipt", async () => {
  for (const proposed of [
    async () => {
      throw Error("secret detail");
    },
    async () => "bad",
  ]) {
    expect(await gateTool({ toolName: "write" }, proposed)).toEqual({
      block: true,
      reason: "Amun could not record this request.",
    });
  }
  const propose = vi.fn(async () => id);
  expect((await gateTool({ toolName: "x\n" }, propose)).block).toBe(true);
  expect(propose).not.toHaveBeenCalled();
});
