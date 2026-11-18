import type { IncomingMessage, Server as HTTPServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { AmunEvent } from "@getpaseo/protocol/amun-rpc";
import type { AgentManager } from "../agent/agent-manager.js";
import { AmunRpcHandler } from "./amun-rpc-handler.js";
import { resolveAmunPaths } from "./amun-paths.js";
import { holdsFromSnapshot, readFleetSnapshot } from "./firstmate-cli.js";
import { PmStore } from "./pm-store.js";
import { PrimarySessions, type PrimaryHost } from "./primary-session.js";
import { ProductSpaceStore } from "./product-spaces.js";

export const AMUN_WS_PATH = "/amun";
const FLEET_POLL_MS = 5_000;

interface AmunLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export interface AttachAmunInput {
  httpServer: HTTPServer;
  agentManager: AgentManager;
  logger: AmunLogger;
  env?: NodeJS.ProcessEnv;
}

export interface AmunAttachment {
  handler: AmunRpcHandler;
  close(): void;
}

function isLoopback(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function pathOf(request: IncomingMessage): string {
  const url = request.url ?? "";
  const index = url.indexOf("?");
  return index === -1 ? url : url.slice(0, index);
}

export function agentManagerHost(agentManager: AgentManager): PrimaryHost {
  return {
    async createAgent(launch) {
      const agent = await agentManager.createAgent(
        { provider: launch.provider, cwd: launch.cwd, title: launch.title },
        undefined,
        { env: launch.env, initialTitle: launch.title, workspaceId: undefined },
      );
      return { agentId: agent.id };
    },
    async runAgent(agentId, text) {
      const result = await agentManager.runAgent(agentId, text);
      return { finalText: result.finalText };
    },
  };
}

/**
 * Mounts Amun's JSON RPC on the Paseo daemon's HTTP server at /amun. Loopback
 * only: the daemon is local-first and the public relay is off by default.
 */
export function attachAmun(input: AttachAmunInput): AmunAttachment | null {
  const env = input.env ?? process.env;
  if (env.AMUN_DISABLE === "1") return null;
  let paths: ReturnType<typeof resolveAmunPaths>;
  try {
    paths = resolveAmunPaths(env);
  } catch (error) {
    input.logger.warn({ err: error }, "Amun RPC not mounted: Firstmate not found");
    return null;
  }
  const spaces = new ProductSpaceStore(paths);
  const primary = new PrimarySessions(agentManagerHost(input.agentManager), paths.firstmateRoot);
  const handler = new AmunRpcHandler({
    spaces,
    primary,
    amunHome: paths.amunHome,
    firstmateRoot: paths.firstmateRoot,
    readSnapshot: (fmHome) => readFleetSnapshot({ root: paths.firstmateRoot, fmHome }),
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  const watched = new Map<WebSocket, Set<string>>();
  const lastSent = new Map<string, string>();

  function send(ws: WebSocket, message: unknown): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  }

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (pathOf(request) !== AMUN_WS_PATH) return;
    if (!isLoopback(request)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
  };
  input.httpServer.on("upgrade", onUpgrade);

  wss.on("connection", (ws: WebSocket) => {
    watched.set(ws, new Set());
    ws.on("message", (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(data));
      } catch {
        send(ws, { id: "unknown", ok: false, error: { code: "InvalidJson", message: "not JSON" } });
        return;
      }
      const space =
        typeof raw === "object" && raw !== null && "space" in raw && typeof raw.space === "string"
          ? raw.space
          : null;
      if (space) watched.get(ws)?.add(space);
      void handler.handleRaw(raw).then((response) => send(ws, response));
    });
    ws.on("close", () => watched.delete(ws));
  });

  // Push fleet and hold changes for every space a connected UI has touched.
  const timer = setInterval(() => {
    const slugs = new Set<string>();
    for (const set of watched.values()) for (const slug of set) slugs.add(slug);
    for (const slug of slugs) {
      void spaces
        .get(slug)
        .then((space) => readFleetSnapshot({ root: paths.firstmateRoot, fmHome: space.fmHome }))
        .then((snapshot) => {
          const { generated: _generated, ...stable } = snapshot;
          const digest = JSON.stringify(stable);
          if (lastSent.get(slug) === digest) return;
          lastSent.set(slug, digest);
          // Keep the board in step with Firstmate's own backlog transitions.
          const store = PmStore.forHome(snapshot.fm_home, paths.amunHome);
          try {
            store.projectBacklog(snapshot.backlog.records);
          } finally {
            store.close();
          }
          const events: AmunEvent[] = [
            { event: "fleet.updated", space: slug, snapshot },
            { event: "holds.updated", space: slug, holds: holdsFromSnapshot(snapshot) },
          ];
          for (const [ws, set] of watched) if (set.has(slug)) for (const e of events) send(ws, e);
        })
        .catch((error: unknown) => input.logger.warn({ err: error, space: slug }, "amun fleet poll failed"));
    }
  }, FLEET_POLL_MS);
  timer.unref();

  input.logger.info(
    { path: AMUN_WS_PATH, fmHome: paths.fmHome, firstmateRoot: paths.firstmateRoot },
    "Amun RPC mounted",
  );
  return {
    handler,
    close() {
      clearInterval(timer);
      input.httpServer.off("upgrade", onUpgrade);
      for (const ws of wss.clients) ws.close();
      wss.close();
    },
  };
}
