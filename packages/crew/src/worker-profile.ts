import { mkdir, lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
export function workerProfileName(
  tool: "codex" | "claude",
  instanceId?: string,
) {
  if (!["codex", "claude"].includes(tool)) throw Error("Invalid worker tool");
  if (instanceId === undefined) return "m0-" + tool;
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      instanceId,
    )
  )
    throw Error("Invalid isolated profile ID");
  return "instance-" + instanceId + "-" + tool;
}
/** Creates missing Amun-owned directories only; never changes existing permissions or files. */
export async function prepareWorkerProfile(
  base: string,
  tool: "codex" | "claude",
  instanceId?: string,
) {
  if (
    !isAbsolute(base) ||
    resolve(base) !== base ||
    /[\0\r\n]/.test(base) ||
    !["codex", "claude"].includes(tool)
  )
    throw Error("Invalid worker profile");
  const parent = dirname(base),
    parentStat = await lstat(parent);
  if (
    !parentStat.isDirectory() ||
    parentStat.isSymbolicLink() ||
    (await realpath(parent)) !== parent ||
    parentStat.uid !== process.getuid?.()
  )
    throw Error("Unsafe worker parent");
  const root = join(base, workerProfileName(tool, instanceId));
  for (const path of [
    base,
    root,
    join(root, "home"),
    join(root, "state"),
    join(root, "work"),
  ]) {
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const info = await lstat(path);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o077) !== 0 ||
      (await realpath(path)) !== path
    )
      throw Error("Unsafe worker profile");
  }
  return root;
}
