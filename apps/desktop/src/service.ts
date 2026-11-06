import { ActionStore } from "../../../packages/data/src/outbox.ts";
import type Database from "better-sqlite3";
import { openWorkspace } from "../../../packages/data/src/workspace.ts";
import { CrewObserver } from "../../service/src/crew-observer.ts";
import { observeOwnedTmux } from "../../../packages/crew/src/observe-owned-tmux.ts";
import { openBackendTerminal } from "../../service/src/backend-terminal.ts";
import { backendTerminalOpen } from "../../../packages/contracts/src/terminal.ts";
import { piOpen } from "../../../packages/contracts/src/index.ts";
import { openPiProtocol } from "../../service/src/pi-runtime.ts";
import { type PiSession } from "../../service/src/pi-session.ts";
import { handleHealthRequest } from "../../service/src/health.js";
import { TerminalSession, type Pty } from "../../service/src/terminal.js";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const requireNative = createRequire(join(process.cwd(), "amun-native.cjs"));
const databaseModule = process.env.AMUN_DATABASE_MODULE;
const workspaceRoot = process.env.AMUN_WORKSPACE_ROOT;
if (!databaseModule || !workspaceRoot)
  throw new Error("Workspace runtime unavailable");
const workspace = openWorkspace(
  workspaceRoot,
  requireNative(databaseModule) as typeof Database,
);
const actions = new ActionStore(workspace);
actions.recover();
const sessions = new Set<TerminalSession>();
process.parentPort?.on("message", (event) => {
  const port = event.ports[0];
  if (!port) return;
  let home: string | undefined;
  let pi: PiSession | undefined;
  let opening = false;
  let closed = false;
  let backendOpening = false;
  let backendEpoch = 0;
  let terminal = new TerminalSession(
    () => {
      const modulePath = process.env.AMUN_TERMINAL_MODULE;
      if (!modulePath) throw new Error("Terminal runtime unavailable");
      const native = requireNative(modulePath) as {
        spawn: (file: string, args: string[], options: unknown) => Pty;
      };
      home ??= mkdtempSync(join(tmpdir(), "amun-terminal-"));
      return native.spawn("/bin/bash", ["--noprofile", "--norc"], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: home,
        env: {
          HOME: home,
          PATH: "/usr/bin:/bin",
          TERM: "xterm-256color",
          LANG: "en_US.UTF-8",
          PS1: "amun-proof$ ",
        },
      });
    },
    (message) => port.postMessage(message),
  );
  sessions.add(terminal);
  const crew = new CrewObserver(
    async (id) => {
      const root = process.env.AMUN_CREW_RECEIPTS;
      const binary = process.env.AMUN_TMUX_BINARY;
      if (!root || !binary) return { endpoint: "unknown", worker: "unknown" };
      return observeOwnedTmux(root, id, binary, "m0");
    },
    (event) => port.postMessage(event),
  );
  port.on("message", (message) => {
    const response = handleHealthRequest(message.data);
    if (response) port.postMessage(response);
    else if (backendTerminalOpen.safeParse(message.data).success) {
      if (backendOpening) return;
      const request = backendTerminalOpen.parse(message.data);
      backendOpening = true;
      const epoch = ++backendEpoch;
      terminal.close();
      sessions.delete(terminal);
      const root = process.env.AMUN_CREW_RECEIPTS,
        binary = process.env.AMUN_TMUX_BINARY,
        modulePath = process.env.AMUN_TERMINAL_MODULE;
      if (!root || !binary || !modulePath) {
        backendOpening = false;
        return;
      }
      const native = requireNative(modulePath) as {
        spawn: (
          file: string,
          args: string[],
          options: unknown,
        ) => Pty & { pid: number };
      };
      void openBackendTerminal(
        root,
        request.taskId,
        binary,
        (file, args, options) => native.spawn(file, args, options),
      )
        .then((pty) => {
          if (closed || epoch !== backendEpoch) {
            pty.kill();
            return;
          }
          terminal = new TerminalSession(
            () => pty,
            (event) => port.postMessage(event),
          );
          sessions.add(terminal);
          terminal.handle({ version: 1, kind: "terminal", action: "open" });
        })
        .catch(() => {
          if (!closed)
            port.postMessage({
              version: 1,
              kind: "terminal-state",
              state: "unavailable",
            });
        })
        .finally(() => {
          backendOpening = false;
        });
    } else if (piOpen.safeParse(message.data).success) {
      if (opening || pi) return;
      opening = true;
      const binary = process.env.AMUN_PI_BINARY;
      const entry = process.env.AMUN_PI_ENTRY;
      if (!binary || !entry) {
        opening = false;
        return;
      }
      const request = piOpen.parse(message.data);
      void openPiProtocol(
        binary,
        entry,
        (event) => {
          if (!closed) port.postMessage(event);
        },
        request.action === "open-provider" ? request.provider : "protocol",
      )
        .then((session) => {
          if (closed) session.close();
          else pi = session;
        })
        .catch(() => {
          if (!closed)
            port.postMessage({
              version: 1,
              kind: "pi-state",
              state: "unavailable",
            });
        })
        .finally(() => {
          opening = false;
        });
    } else {
      void crew.handle(message.data);
      if (
        backendOpening &&
        message.data?.kind === "terminal" &&
        message.data?.action === "close"
      )
        backendEpoch++;
      if (!backendOpening) terminal.handle(message.data);
      void pi?.handle(message.data);
      if (message.data?.kind === "pi" && message.data?.action === "close")
        pi = undefined;
    }
  });
  port.on("close", () => {
    closed = true;
    crew.close();
    pi?.close();
    terminal.close();
    sessions.delete(terminal);
    if (home) rmSync(home, { recursive: true, force: true });
  });
  port.start();
});
process.on("exit", () => {
  workspace.close();
  for (const terminal of sessions) terminal.close();
});
