import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { preparePiAuth, parseReadiness } from "./pi-auth.ts";
import { withRefreshLock } from "./broker.ts";
import { modelLoginOptions } from "../../contracts/src/auth.ts";
const exec = promisify(execFile);
type Run = (
  binary: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    cwd: string;
    timeout: number;
    maxBuffer: number;
  },
) => Promise<string>;
export async function checkPiReadiness(
  binary: string,
  entry: string,
  root: string,
  provider: string,
  run: Run = async (binary, args, options) => {
    try {
      return (await exec(binary, args, options)).stdout;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === 1 || error.code === 2) &&
        "stdout" in error &&
        typeof error.stdout === "string"
      )
        return error.stdout;
      throw error;
    }
  },
): Promise<"configured" | "missing" | "error"> {
  try {
    if (!modelLoginOptions.some((option) => option.provider === provider))
      return "error";
    await preparePiAuth(root);
    return await withRefreshLock(root, async () => {
      const output = await run(
        binary,
        [entry, "auth", "check", "--provider", provider, "--json"],
        {
          cwd: root,
          timeout: 20000,
          maxBuffer: 65536,
          env: {
            HOME: root,
            PATH: "/usr/bin:/bin",
            ELECTRON_RUN_AS_NODE: "1",
            PI_CODING_AGENT_DIR: root,
            PI_SKIP_VERSION_CHECK: "1",
            ...(process.env.NODE_EXTRA_CA_CERTS
              ? { NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS }
              : {}),
          },
        },
      );
      return parseReadiness(provider, output);
    });
  } catch {
    return "error";
  }
}
