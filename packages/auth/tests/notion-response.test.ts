import { expect, it } from "vitest";
import { boundedMcpResponse } from "../src/notion-response.ts";
it("bounds streamed MCP response bytes before parsing", async () => {
  expect(await boundedMcpResponse(new Response("small"), 8).text()).toBe(
    "small",
  );
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
        controller.enqueue(new Uint8Array(5));
        controller.close();
      },
    }),
  );
  await expect(boundedMcpResponse(response, 8).text()).rejects.toThrow(
    "MCP response exceeds limits",
  );
});
