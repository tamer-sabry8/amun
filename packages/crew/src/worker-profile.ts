import { mkdir, lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
/** Creates missing Amun-owned directories only; never changes existing permissions or files. */
export async function prepareWorkerProfile(
  base: string,
  tool: "codex" | "claude",
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
  const root = join(base, "m0-" + tool);
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
