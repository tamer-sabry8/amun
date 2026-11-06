import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, join } from "node:path";
import {
  nativePiCommand,
  nativePiEvent,
  type NativePiEvent,
} from "../../../packages/contracts/src/native-pi.ts";
import { JsonLineDecoder } from "../../../packages/crew/src/jsonl.ts";
export class NativePiProcess {
  private child: ChildProcessWithoutNullStreams | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: string | undefined;
  constructor(
    private readonly config: {
      binary: string;
      worker: string;
      entry: string;
      root: string;
    },
    private readonly send: (event: NativePiEvent) => void,
  ) {}
  private failure() {
    if (this.pending)
      this.send({
        version: 1,
        kind: "native-pi-result",
        id: this.pending,
        result: {
          kind: "message",
          text: "Native Pi is unavailable. Reopen the command view to retry.",
        },
      });
    this.pending = undefined;
  }
  handle(input: unknown) {
    const parsed = nativePiCommand.safeParse(input);
    if (!parsed.success) return;
    const command = parsed.data;
    if (command.action === "close") {
      this.close();
      return;
    }
    if (this.pending) {
      this.send({
        version: 1,
        kind: "native-pi-result",
        id: command.id,
        result: {
          kind: "message",
          text: "Wait for the current native operation.",
        },
      });
      return;
    }
    if (!this.child) {
      const { binary, worker, entry, root } = this.config;
      const child = spawn(binary, [worker], {
        env: {
          HOME: root,
          PATH: "/usr/bin:/bin",
          ELECTRON_RUN_AS_NODE: "1",
          PI_CODING_AGENT_DIR: root,
          PI_SKIP_VERSION_CHECK: "1",
          AMUN_AUTH_ROOT: root,
          AMUN_AUTH_SDK: join(dirname(dirname(entry)), "index.js"),
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.child = child;
      const decoder = new JsonLineDecoder(1048576);
      child.stdout.setEncoding("utf8");
      child.stderr.resume();
      child.stdin.on("error", () => {});
      child.stdout.on("data", (chunk: string) => {
        if (this.child !== child) return;
        try {
          for (const frame of decoder.push(chunk)) {
            const event = nativePiEvent.parse(frame);
            if (event.id !== this.pending)
              throw Error("Unexpected native reply");
            clearTimeout(this.timer);
            this.pending = undefined;
            this.send(event);
          }
        } catch {
          this.failure();
          this.close();
        }
      });
      const finished = () => {
        if (this.child === child) {
          clearTimeout(this.timer);
          this.failure();
          this.child = undefined;
        }
      };
      child.once("error", finished);
      child.once("exit", finished);
    }
    this.pending = command.id;
    this.timer = setTimeout(() => {
      this.failure();
      this.close();
    }, 60000);
    this.timer.unref();
    this.child.stdin.write(JSON.stringify(command) + "\n");
  }
  close() {
    clearTimeout(this.timer);
    this.pending = undefined;
    const child = this.child;
    this.child = undefined;
    if (!child) return;
    child.kill();
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }, 3000);
    timer.unref();
    child.once("exit", () => clearTimeout(timer));
  }
}
