import { createServer, type Socket } from "node:net";
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import {
  bridgeFrame,
  type BridgeRequest,
} from "../../contracts/src/pi-bridge.ts";
export async function openBridge(
  handle: (request: BridgeRequest) => Promise<string>,
  privateParent = "/tmp",
) {
  const directory = await mkdtemp(join(privateParent, "amun-bridge-"));
  const path = join(directory, "rpc.sock");
  const token = randomBytes(32).toString("hex");
  const sockets = new Set<Socket>();
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.on("error", () => socket.destroy());
    const timer = setTimeout(() => socket.destroy(), 5000);
    socket.once("close", () => {
      clearTimeout(timer);
      sockets.delete(socket);
    });
    let body = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      body += chunk;
      if (Buffer.byteLength(body) > 8192) socket.destroy();
    });
    socket.once("end", async () => {
      try {
        if (socket.destroyed) return;
        const frame = bridgeFrame.parse(JSON.parse(body));
        if (!timingSafeEqual(Buffer.from(frame.token), Buffer.from(token)))
          throw Error();
        const value = await handle(frame.request);
        socket.end(JSON.stringify({ value }));
      } catch {
        socket.end("{}");
      }
    });
  });
  server.maxConnections = 16;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(path, resolve);
    });
    await chmod(path, 0o600);
  } catch (error) {
    if (server.listening) server.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    path,
    token,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
