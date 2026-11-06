import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";

export interface ExistingSetup {
  piPackageDirectory: string;
  firstmateHome: string;
  piConfigDirectory: string;
  amunStateDirectory: string;
  firstmateCodeDirectory?: string;
}

async function canonical(path: string): Promise<string> {
  if (!isAbsolute(path))
    throw new Error("Choose an absolute installation path");
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await canonical(parent), basename(path));
  }
}
function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return (
    path === "" ||
    (!isAbsolute(path) && path !== ".." && !path.startsWith("../"))
  );
}
/** Check both nesting directions, including aliases through existing symlinks. Recheck before launch. */
export async function assertIsolatedStatePath(
  candidate: string,
  protectedPaths: string[],
): Promise<void> {
  const state = await canonical(candidate);
  for (const path of protectedPaths) {
    const protectedPath = await canonical(path);
    if (contains(state, protectedPath) || contains(protectedPath, state))
      throw new Error("Amun state overlaps an existing installation or home");
  }
}
async function readSmallRegularFile(path: string): Promise<string> {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 16384)
      throw new Error("Unsupported metadata file");
    const bytes = Buffer.alloc(16385);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 16384) throw new Error("Metadata too large");
    return bytes.subarray(0, bytesRead).toString("utf8");
  } finally {
    await file.close();
  }
}
type SessionObservation =
  "possibly_running" | "stale_lock" | "not_observed" | "unknown";
async function observeLock(home: string): Promise<SessionObservation> {
  let lock: string;
  try {
    const root = await realpath(home);
    const state = await realpath(join(root, "state"));
    if (!contains(root, state)) return "unknown";
    lock = await readSmallRegularFile(join(state, ".lock"));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? "not_observed"
      : "unknown";
  }
  const first = lock.split(/\r?\n/, 1)[0] ?? "";
  if (!/^[1-9][0-9]{0,9}$/.test(first)) return "unknown";
  const pid = Number(first);
  try {
    process.kill(pid, 0);
    return "possibly_running";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return "stale_lock";
    if (code === "EPERM") return "possibly_running";
    return "unknown";
  }
}
/** Read-only inventory. Never executes external tools, opens credentials, changes a lock, or starts a session. */
export async function inspectExistingSetup(input: ExistingSetup) {
  await assertIsolatedStatePath(input.amunStateDirectory, [
    input.piPackageDirectory,
    input.firstmateHome,
    input.piConfigDirectory,
    ...(input.firstmateCodeDirectory ? [input.firstmateCodeDirectory] : []),
  ]);
  const piDirectory = await realpath(input.piPackageDirectory);
  const version = await readPiVersion(piDirectory);
  return {
    piVersion: version,
    versionMatchesBaseline: version === "1.4.0",
    compatibility: "requires_rpc_probe" as const,
    firstmateSession: await observeLock(input.firstmateHome),
    reuseMode: "installed_tools_isolated_state" as const,
    attachSupported: false as const,
    authentication: "explicit_choice_required" as const,
  };
}

async function readPiVersion(piDirectory: string): Promise<string> {
  let metadata: unknown;
  try {
    metadata = JSON.parse(
      await readSmallRegularFile(join(piDirectory, "package.json")),
    );
  } catch {
    throw new Error("Unreadable Pi package metadata");
  }
  if (
    !metadata ||
    typeof metadata !== "object" ||
    !("name" in metadata) ||
    metadata.name !== "@earendil-works/pi-coding-agent" ||
    !("version" in metadata) ||
    typeof metadata.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      metadata.version,
    )
  )
    throw new Error("Unrecognised Pi package metadata");
  return metadata.version;
}

/** Resolve candidate links and inspect bounded metadata; never invoke a candidate. */
export async function discoverPiInstallations(
  candidates: string[],
): Promise<
  { executable: string; packageDirectory: string; version: string }[]
> {
  const found: {
    executable: string;
    packageDirectory: string;
    version: string;
  }[] = [];
  const seen = new Set<string>();
  for (const executable of candidates) {
    if (!isAbsolute(executable)) continue;
    try {
      const entry = await realpath(executable);
      if (!(await stat(entry)).isFile()) continue;
      let directory = dirname(entry);
      for (let depth = 0; depth < 6; depth++) {
        try {
          const version = await readPiVersion(directory);
          if (!seen.has(directory)) {
            found.push({ executable, packageDirectory: directory, version });
            seen.add(directory);
          }
          break;
        } catch {
          // Missing or unsupported metadata is not an installation match.
        }
        const parent = dirname(directory);
        if (parent === directory) break;
        directory = parent;
      }
    } catch {
      // Missing or unreadable candidates remain unresolved for manual selection.
    }
  }
  return found;
}
