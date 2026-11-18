import { describe, expect, it } from "vitest";
import { AmunClient } from "../src/daemon/amun-client.ts";

class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  send(frame: string) {
    this.sent.push(frame);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
  close() {}
}

describe("Amun daemon client", () => {
  it("fails a request that was on the wire when the connection dropped, and never resends it", async () => {
    (globalThis as { WebSocket?: unknown }).WebSocket ??= { OPEN: 1 };
    const sockets: FakeSocket[] = [];
    const client = new AmunClient("ws://x/amun", () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    });
    sockets[0]!.open();
    const pending = client.request("primary.send", { text: "go" });
    expect(sockets[0]!.sent).toHaveLength(1);
    sockets[0]!.drop();
    await expect(pending).rejects.toMatchObject({
      error: { code: "interrupted" },
    });
    client.close();
  });

  it("still sends requests queued while disconnected once it reconnects", async () => {
    (globalThis as { WebSocket?: unknown }).WebSocket ??= { OPEN: 1 };
    const sockets: FakeSocket[] = [];
    const client = new AmunClient("ws://x/amun", () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    });
    const pending = client.request<string>("spaces.list");
    sockets[0]!.open();
    const { id } = JSON.parse(sockets[0]!.sent[0]!) as { id: string };
    sockets[0]!.onmessage?.({
      data: JSON.stringify({ id, ok: true, result: "ok" }),
    });
    await expect(pending).resolves.toBe("ok");
    client.close();
  });
});
