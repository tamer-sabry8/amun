import { lstat, readdir, realpath, symlink, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
}
async function links(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) result.push(path);
    else if (entry.isDirectory()) result.push(...(await links(path)));
  }
  return result;
}
export async function assertRuntimeContained(directory: string): Promise<void> {
  const root = await realpath(directory);
  for (const link of await links(root)) {
    if (!within(root, await realpath(link)))
      throw new Error("Runtime dependency escapes packaged tree");
  }
}
/** Node cp's default rewrites links against the build source. Rebind them inside the copied tree. */
export async function repairRuntimeLinks(
  sourceDirectory: string,
  targetDirectory: string,
): Promise<void> {
  const source = await realpath(sourceDirectory);
  await assertRuntimeContained(source);
  const target = await realpath(targetDirectory);
  for (const link of await links(source)) {
    const resolved = await realpath(link);
    const copied = join(target, relative(source, link));
    if (!(await lstat(copied)).isSymbolicLink())
      throw new Error("Expected copied runtime symlink");
    await unlink(copied);
    await symlink(
      relative(dirname(copied), join(target, relative(source, resolved))),
      copied,
    );
  }
  await assertRuntimeContained(target);
}

/** pnpm legacy deploy includes a development-only self-link; it is not a runtime dependency. */
export async function removeDeploymentSelfLink(
  staged: string,
  project: string,
  packageName = "pi-runtime",
): Promise<void> {
  if (!["pi-runtime", "terminal-runtime"].includes(packageName))
    throw new Error("Unsupported deployment package");
  const link = join(
    staged,
    "node_modules/.pnpm/node_modules/@amun",
    packageName,
  );
  let entry;
  try {
    entry = await lstat(link);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (
    !entry.isSymbolicLink() ||
    (await realpath(link)) !== (await realpath(project))
  )
    throw new Error("Unexpected runtime self-reference");
  await unlink(link);
}
