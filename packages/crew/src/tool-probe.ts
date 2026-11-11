import { execFile } from "node:child_process";
import { access, constants, realpath } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type {
  KnownTool,
  ProbeResult,
} from "../../domain/src/tool-detection.ts";

const run = promisify(execFile);

/** Finds an executable by exact name in the given path list. */
export async function findOnPath(
  command: string,
  pathList: string,
): Promise<string | null> {
  if (!/^[A-Za-z0-9._-]+$/.test(command)) throw Error("Invalid command name");
  for (const directory of pathList.split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const candidate = join(directory, command);
    try {
      await access(candidate, constants.X_OK);
      return await realpath(candidate);
    } catch {
      // Not in this directory.
    }
  }
  return null;
}

/**
 * Probes one known tool: looks its name up on the path, then runs only its
 * declared version command with a short timeout, no shell and a minimal
 * environment. Output is returned as text and never interpreted.
 */
export async function probeTool(
  tool: KnownTool,
  options: { pathList: string; explicitPath?: string; timeoutMs?: number },
): Promise<ProbeResult> {
  let path: string | null;
  try {
    path = options.explicitPath
      ? await realpath(options.explicitPath)
      : await findOnPath(tool.command, options.pathList);
  } catch {
    path = null;
  }
  if (!path) return { found: false };
  try {
    const { stdout, stderr } = await run(path, [...tool.versionArgs], {
      timeout: options.timeoutMs ?? 5000,
      maxBuffer: 65536,
      shell: false,
      env: { PATH: options.pathList, HOME: process.env.HOME ?? "/", LANG: "C" },
    });
    return { found: true, path, versionText: (stdout || stderr).slice(0, 400) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      found: true,
      path,
      denied: code === "EACCES" || code === "EPERM",
      error: code === "ETIMEDOUT" ? "Timed out" : "Could not run",
    };
  }
}
