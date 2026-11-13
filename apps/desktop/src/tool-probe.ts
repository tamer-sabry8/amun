// Looks for agent command-line tools already on this Mac. For each known
// tool it searches a fixed list of folders and, when found, runs only that
// tool's fixed version command. It never runs a shell, a sign-in command or
// anything supplied from outside, and it reads no credentials.
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import type {
  KnownTool,
  ProbeResult,
} from "../../../packages/domain/src/tool-detection.ts";

/** Folders searched, in order: common install locations, then the PATH. */
export async function searchFolders(
  home = homedir(),
  path = process.env.PATH ?? "",
): Promise<string[]> {
  const folders = [
    join(home, ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(home, ".bun/bin"),
    join(home, ".cargo/bin"),
    join(home, ".npm-global/bin"),
    join(home, ".volta/bin"),
    "/usr/bin",
    "/bin",
  ];
  // Tools installed with a Node version manager live under its versions.
  for (const root of [join(home, ".nvm/versions/node")])
    try {
      for (const version of (await readdir(root)).sort().reverse())
        folders.push(join(root, version, "bin"));
    } catch {
      // No version manager here.
    }
  for (const entry of path.split(delimiter))
    if (isAbsolute(entry)) folders.push(entry);
  return [...new Set(folders)];
}

type Run = (
  file: string,
  args: readonly string[],
  /** Folders a script tool may need to find its own interpreter. */
  folders: readonly string[],
) => Promise<{ stdout: string; denied?: boolean }>;
const run: Run = (file, args, folders) =>
  new Promise((resolve, reject) =>
    execFile(
      file,
      [...args],
      {
        timeout: 5000,
        maxBuffer: 64 * 1024,
        // Only what printing a version needs. Many tools are scripts, so the
        // searched folders are on the path for their interpreter (node, bun).
        env: {
          PATH: [...folders, "/usr/bin", "/bin"].join(delimiter),
          HOME: homedir(),
          NO_COLOR: "1",
        },
      },
      (error, stdout, stderr) => {
        const code = (error as NodeJS.ErrnoException | null)?.code;
        if (code === "EACCES" || code === "EPERM")
          return resolve({ stdout: "", denied: true });
        // Some tools print their version and still exit non-zero.
        if (error && !stdout && !stderr) return reject(error);
        resolve({ stdout: (stdout || stderr).slice(0, 512) });
      },
    ),
  );

export async function probeTool(
  tool: KnownTool & { explicitPath?: string },
  folders: readonly string[],
  execute: Run = run,
): Promise<ProbeResult> {
  const candidates = tool.explicitPath
    ? [tool.explicitPath]
    : folders.map((folder) => join(folder, tool.command));
  let found: string | undefined;
  for (const candidate of candidates)
    try {
      await access(candidate, constants.X_OK);
      found = candidate;
      break;
    } catch {
      // Not here; keep looking.
    }
  if (!found) return { found: false };
  try {
    const result = await execute(found, tool.versionArgs, folders);
    return result.denied
      ? { found: true, path: found, denied: true }
      : { found: true, path: found, versionText: result.stdout };
  } catch {
    return { found: true, path: found, error: "version" };
  }
}

/** Probes every tool, a few at a time. */
export async function probeTools(
  tools: readonly (KnownTool & { explicitPath?: string })[],
  execute: Run = run,
): Promise<Record<string, ProbeResult>> {
  const folders = await searchFolders();
  const results: Record<string, ProbeResult> = {};
  await Promise.all(
    tools.map(async (tool) => {
      results[tool.id] = await probeTool(tool, folders, execute);
    }),
  );
  return results;
}
