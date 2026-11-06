import { handleHealthRequest } from "../../service/src/health.js";
import { TerminalSession, type Pty } from "../../service/src/terminal.js";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const requireNative = createRequire(join(process.cwd(), "amun-native.cjs"));
const sessions = new Set<TerminalSession>();
process.parentPort?.on("message", (event) => {
  const port = event.ports[0];
  if (!port) return;
  let home: string | undefined;
  const terminal = new TerminalSession(
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
  port.on("message", (message) => {
    const response = handleHealthRequest(message.data);
    if (response) port.postMessage(response);
    else terminal.handle(message.data);
  });
  port.on("close", () => {
    terminal.close();
    sessions.delete(terminal);
    if (home) rmSync(home, { recursive: true, force: true });
  });
  port.start();
});
process.on("exit", () => {
  for (const terminal of sessions) terminal.close();
});
