import { createConnection } from "node:net";

export function bridgeCall(
  path: string,
  token: string,
  request: unknown,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let reply = "";
    const timer = setTimeout(
      () => socket.destroy(Error("Bridge timeout")),
      4000,
    );
    socket.setEncoding("utf8");
    socket.once("connect", () =>
      socket.end(JSON.stringify({ token, request })),
    );
    socket.on("data", (chunk: string) => {
      reply += chunk;
      if (Buffer.byteLength(reply) > 8192)
        socket.destroy(Error("Invalid bridge reply"));
    });
    socket.once("error", () => reject(Error("Bridge unavailable")));
    socket.once("close", () => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(reply);
        if (typeof result.value !== "string") throw Error();
        resolve(result.value);
      } catch {
        reject(Error("Bridge request refused"));
      }
    });
  });
}
