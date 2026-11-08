import { spawn } from "node:child_process";
/** One-shot CLI commands get EOF immediately and own a process group for bounded cleanup. */
export function runClosedInput(
  executable: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeout: number;
    maxBuffer: number;
    signal?: AbortSignal;
  },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const failure = () => new Error("Worker command failed");
    if (options.signal?.aborted) {
      reject(failure());
      return;
    }
    const grouped = process.platform !== "win32";
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      detached: grouped,
    });
    let stdout = "",
      stderr = "",
      bytes = 0,
      failed = false,
      finished = false;
    let force: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (grouped && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        /* Already exited. */
      }
    };
    const stop = () => {
      if (finished || failed) return;
      failed = true;
      kill("SIGTERM");
      force = setTimeout(() => kill("SIGKILL"), 3000);
    };
    const timer = setTimeout(stop, options.timeout);
    options.signal?.addEventListener("abort", stop, { once: true });
    for (const [stream, name] of [
      [child.stdout, "stdout"],
      [child.stderr, "stderr"],
    ] as const) {
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > options.maxBuffer) {
          stop();
          return;
        }
        if (name === "stdout") stdout += chunk;
        else stderr += chunk;
      });
    }
    child.on("error", () => {
      failed = true;
    });
    child.on("close", (code, signal) => {
      finished = true;
      clearTimeout(timer);
      clearTimeout(force);
      options.signal?.removeEventListener("abort", stop);
      if (failed || code !== 0 || signal) reject(failure());
      else resolve({ stdout, stderr });
    });
    child.stdin.on("error", () => {});
    child.stdin.end();
  });
}
