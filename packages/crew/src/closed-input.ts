import { execFile } from "node:child_process";
/** One-shot CLI commands get EOF immediately; interactive login uses a separate transport. */
export function runClosedInput(
  executable: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeout: number;
    maxBuffer: number;
  },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      executable,
      args,
      { ...options, encoding: "utf8", shell: false },
      (error, stdout, stderr) => {
        if (error) reject(new Error("Worker command failed"));
        else resolve({ stdout, stderr });
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end();
  });
}
