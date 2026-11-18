// The Council's room: upstream's small viewer app, run on a random loopback
// port from the composed runtime. It only plays back the session files the
// Chair writes; Amun shows it inside its isolated browser view.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });

export interface RoomOptions {
  /** Node binary and any environment it needs (Electron runs as Node). */
  node: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}
export class Room {
  private child: ChildProcess | null = null;
  private port = 0;
  private readonly dir: string;
  private readonly options: RoomOptions;
  constructor(runtimeDir: string, options: RoomOptions) {
    this.dir = runtimeDir;
    this.options = options;
  }
  get url() {
    return this.child ? `http://127.0.0.1:${this.port}/` : null;
  }
  /** Starts the room and resolves with its address once it answers. */
  async start(): Promise<string> {
    if (this.child && this.url) return this.url;
    this.port = await freePort();
    const child = spawn(this.options.node, [join(this.dir, "app/server.mjs")], {
      cwd: this.dir,
      stdio: "ignore",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        ...this.options.env,
        PORT: String(this.port),
        // Viewer only: the room never runs councils or spends tokens itself.
        COUNCIL_RUNNER: "viewer",
      },
    });
    this.child = child;
    child.once("exit", () => {
      if (this.child === child) this.child = null;
    });
    child.once("error", () => {
      if (this.child === child) this.child = null;
    });
    const deadline = Date.now() + (this.options.timeoutMs ?? 8000);
    for (;;) {
      if (!this.child) throw Error("The room stopped before it was ready.");
      try {
        const response = await fetch(`http://127.0.0.1:${this.port}/api/seats`);
        if (response.ok) return this.url!;
      } catch {
        /* Not listening yet. */
      }
      if (Date.now() > deadline) {
        this.stop();
        throw Error("The room did not start in time.");
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }
  /** Seat keys the running room reports; used to validate an update. */
  async seatKeys(): Promise<string[]> {
    const url = await this.start();
    const body = (await (await fetch(url + "api/seats")).json()) as {
      seats?: { key?: string }[];
    };
    return (body.seats ?? []).map((seat) => String(seat.key));
  }
  stop() {
    this.child?.kill();
    this.child = null;
  }
}

/**
 * Update validation: the room must start from the candidate and report
 * exactly the composed roster.
 */
export async function probeRoom(
  runtimeDir: string,
  expected: string[],
  options: RoomOptions,
): Promise<string[]> {
  const room = new Room(runtimeDir, options);
  try {
    const keys = await room.seatKeys();
    return JSON.stringify(keys) === JSON.stringify(expected)
      ? []
      : ["The room does not show the same advisors as the roster."];
  } catch (error) {
    return [error instanceof Error ? error.message : "The room did not start."];
  } finally {
    room.stop();
  }
}
