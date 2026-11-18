// Minimal JSON RPC client for the daemon's /amun WebSocket (packages/server
// src/server/amun/attach-amun.ts). Reconnects with backoff; requests made
// while disconnected wait for the next connection.

export interface AmunRpcError {
  code: string;
  message: string;
}

export type AmunEventMessage = {
  event: string;
  space?: string;
  [key: string]: unknown;
};

export class AmunRequestError extends Error {
  constructor(public readonly error: AmunRpcError) {
    super(error.message);
    this.name = "AmunRequestError";
  }
}

export interface AmunTransport {
  request<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
  onEvent(listener: (event: AmunEventMessage) => void): () => void;
  onStatus(listener: (connected: boolean) => void): () => void;
}

export function defaultDaemonUrl(
  location: { search: string } = window.location,
): string {
  const fromQuery = new URLSearchParams(location.search).get("daemon");
  return fromQuery ?? "ws://127.0.0.1:6767/amun";
}

export class AmunClient implements AmunTransport {
  private socket: WebSocket | null = null;
  private pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private queue: { id: string; frame: string }[] = [];
  /** Requests written to the current socket and not answered yet. */
  private sent = new Set<string>();
  private events = new Set<(event: AmunEventMessage) => void>();
  private statuses = new Set<(connected: boolean) => void>();
  private retry = 0;
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly makeSocket: (url: string) => WebSocket = (u) =>
      new WebSocket(u),
  ) {
    this.connect();
  }

  private connect() {
    if (this.closed) return;
    const socket = this.makeSocket(this.url);
    this.socket = socket;
    socket.onopen = () => {
      this.retry = 0;
      for (const listener of this.statuses) listener(true);
      for (const { id, frame } of this.queue.splice(0)) {
        this.sent.add(id);
        socket.send(frame);
      }
    };
    socket.onmessage = (message) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(String(message.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (typeof data.event === "string") {
        for (const listener of this.events) listener(data as AmunEventMessage);
        return;
      }
      const waiter =
        typeof data.id === "string" ? this.pending.get(data.id) : undefined;
      if (!waiter) return;
      this.pending.delete(data.id as string);
      this.sent.delete(data.id as string);
      if (data.ok === true) waiter.resolve(data.result);
      else waiter.reject(new AmunRequestError(data.error as AmunRpcError));
    };
    socket.onclose = () => {
      this.interruptSent();
      for (const listener of this.statuses) listener(false);
      if (this.closed) return;
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  request<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const id = crypto.randomUUID();
    const frame = JSON.stringify({ id, method, ...params });
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.sent.add(id);
        this.socket.send(frame);
      } else this.queue.push({ id, frame });
    });
  }

  /**
   * A request already on the wire when the socket drops may or may not have
   * run, so it fails instead of being sent again (it could change something).
   */
  private interruptSent() {
    for (const id of this.sent) {
      this.pending.get(id)?.reject(
        new AmunRequestError({
          code: "interrupted",
          message:
            "The connection to Amun's service dropped before it answered. Check whether it went through before trying again.",
        }),
      );
      this.pending.delete(id);
    }
    this.sent.clear();
  }

  onEvent(listener: (event: AmunEventMessage) => void) {
    this.events.add(listener);
    return () => void this.events.delete(listener);
  }

  onStatus(listener: (connected: boolean) => void) {
    this.statuses.add(listener);
    return () => void this.statuses.delete(listener);
  }

  close() {
    this.closed = true;
    this.socket?.close();
  }
}
