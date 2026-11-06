import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type Pty } from "./terminal.ts";
import { loadEndpointReceipt } from "../../../packages/crew/src/endpoint-receipt.ts";
import { observeOwnedTmux } from "../../../packages/crew/src/observe-owned-tmux.ts";
import { clientControlArguments } from "../../../packages/crew/src/tmux-terminal.ts";
export async function openBackendTerminal(
  root: string,
  taskId: string,
  binary: string,
  spawn: (
    file: string,
    args: string[],
    options: unknown,
  ) => Pty & { pid: number },
): Promise<Pty> {
  const receipt = await loadEndpointReceipt(root, taskId);
  const verify = async () => {
    if (
      JSON.stringify(await loadEndpointReceipt(root, taskId)) !==
        JSON.stringify(receipt) ||
      (await observeOwnedTmux(root, taskId, binary)).endpoint !== "verified"
    )
      throw Error("Backend identity unavailable");
  };
  await verify();
  const pty = spawn(
    binary,
    [
      "-N",
      "-f",
      "/dev/null",
      "-S",
      receipt.socket,
      "attach-session",
      "-r",
      "-t",
      receipt.identity.window,
    ],
    {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: receipt.identity.worktree,
      env: {
        HOME: receipt.home,
        PATH: "/usr/bin:/bin",
        TERM: "xterm-256color",
        LANG: "en_US.UTF-8",
      },
    },
  );
  let controls = Promise.resolve();
  return {
    write: (data) => pty.write(data),
    resize: (cols, rows) => pty.resize(cols, rows),
    kill: () => pty.kill(),
    onData: (listener) => pty.onData(listener),
    onExit: (listener) => pty.onExit(listener),
    setControl: (enabled) => {
      controls = controls.then(async () => {
        await verify();
        const run = async (args: string[]) =>
          (
            await promisify(execFile)(
              binary,
              ["-N", "-S", receipt.socket, ...args],
              {
                env: { PATH: "/usr/bin:/bin" },
                timeout: 3000,
                maxBuffer: 65536,
              },
            )
          ).stdout;
        const clients = await run([
          "list-clients",
          "-F",
          "#{client_pid}|#{client_tty}|#{client_readonly}",
        ]);
        const args = clientControlArguments(pty.pid, clients, enabled);
        if (args.length) await run(args);
        const after = await run([
          "list-clients",
          "-F",
          "#{client_pid}|#{client_tty}|#{client_readonly}",
        ]);
        if (clientControlArguments(pty.pid, after, enabled).length)
          throw Error("Terminal control state not confirmed");
      });
      return controls;
    },
  };
}
