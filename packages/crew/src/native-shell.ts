import { spawn } from "node:child_process";
import { userInfo } from "node:os";

export interface ShellResult {
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
}
export async function runCaptainShell(
  command: string,
  cwd: string,
  signal: AbortSignal,
): Promise<ShellResult> {
  if (!command.trim() || command.length > 8192 || command.includes("\0"))
    throw Error("Invalid shell command");
  signal.throwIfAborted();
  const account = userInfo();
  const shell = account.shell || "/bin/zsh";
  const child = spawn(shell, ["-l", "-c", command], {
    cwd,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      HOME: account.homedir,
      USER: account.username,
      LOGNAME: account.username,
      SHELL: shell,
      PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      LANG: "en_US.UTF-8",
      TERM: "dumb",
    },
  });
  const chunks: Buffer[] = [];
  let bytes = 0,
    truncated = false,
    cancelled = false;
  const collect = (data: Buffer) => {
    const take = Math.min(data.length, 65536 - bytes);
    if (take) {
      chunks.push(Buffer.from(data.subarray(0, take)));
      bytes += take;
    }
    if (take < data.length) truncated = true;
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const cancel = () => {
    cancelled = true;
    if (child.pid)
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* Already exited. */
      }
  };
  signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, 30000);
  try {
    const exitCode = await new Promise<number | undefined>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => resolve(code ?? undefined));
      },
    );
    return {
      exitCode,
      output: Buffer.concat(chunks).toString("utf8"),
      cancelled,
      truncated,
    };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
