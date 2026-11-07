import { expect, it, vi } from "vitest";
import { openBridge } from "../src/socket.ts";
import { bridgeCall } from "../src/client.ts";
it("authenticates a local request and revokes access on close", async () => {
  const handle = vi.fn(async () => "received");
  const bridge = await openBridge(handle);
  try {
    expect(
      await bridgeCall(bridge.path, bridge.token, {
        op: "event",
        name: "agent_start",
      }),
    ).toBe("received");
    await expect(
      bridgeCall(bridge.path, "0".repeat(64), {
        op: "event",
        name: "agent_start",
      }),
    ).rejects.toThrow();
    await expect(
      bridgeCall(bridge.path, bridge.token, { op: "approve", name: "merge" }),
    ).rejects.toThrow();
    expect(handle).toHaveBeenCalledTimes(1);
  } finally {
    await bridge.close();
  }
  await expect(
    bridgeCall(bridge.path, bridge.token, { op: "event", name: "agent_start" }),
  ).rejects.toThrow();
});
