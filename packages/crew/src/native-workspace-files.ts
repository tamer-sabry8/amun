import { constants } from "node:fs";
import { open, opendir, realpath, lstat } from "node:fs/promises";
import { join, dirname } from "node:path";
const token = /(?:^|\s)@([^@\s]*)$/u;
function permitted(path: string) {
  const parts = path.split("/");
  return (
    !path.startsWith("/") &&
    path.length <= 512 &&
    parts[0] !== "sessions" &&
    parts.every(
      (part) => !part.startsWith(".") && !/[\\\p{Cc}\p{Cf}]/u.test(part),
    )
  );
}
export function workspaceReference(draft: string) {
  const found = token.exec(draft);
  if (!found || !permitted(found[1]!))
    throw Error("Unsupported workspace reference");
  return found[1]!;
}
export async function workspaceFileChoices(root: string, draft: string) {
  const prefix = workspaceReference(draft),
    slash = prefix.lastIndexOf("/"),
    parent = prefix.slice(0, slash + 1),
    query = prefix.slice(slash + 1);
  const directory = join(root, parent);
  if (
    (await realpath(directory)) !== directory ||
    !(await lstat(directory)).isDirectory()
  )
    throw Error("Unexpected workspace directory");
  const options: string[] = [];
  let scanned = 0;
  for await (const entry of await opendir(directory)) {
    if (++scanned > 4096) break;
    if (
      (entry.isFile() || entry.isDirectory()) &&
      entry.name.startsWith(query) &&
      permitted(parent + entry.name)
    ) {
      options.push(parent + entry.name + (entry.isDirectory() ? "/" : ""));
    }
  }
  return options.sort().slice(0, 100);
}
export async function completeWorkspaceFile(
  root: string,
  draft: string,
  pick: string,
) {
  if (!(await workspaceFileChoices(root, draft)).includes(pick))
    throw Error("Workspace selection changed");
  const before = draft.slice(
    0,
    draft.length - workspaceReference(draft).length - 1,
  );
  if (pick.endsWith("/")) return before + "@" + pick;
  const path = join(root, pick),
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.size > 12000 ||
      info.nlink !== 1 ||
      (await realpath(dirname(path))) !== dirname(path) ||
      (await lstat(path)).ino !== info.ino
    )
      throw Error("Unsupported workspace file");
    const bytes = Buffer.alloc(12001),
      { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== info.size) throw Error("Workspace file changed");
    const content = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, bytesRead),
    );
    if (/[\p{Cc}]/u.test(content.replace(/[\r\n\t]/g, "")))
      throw Error("Expected text file");
    const result =
      before.trimEnd() + "\n\nAttached file: " + pick + "\n" + content;
    if (result.length > 12000) throw Error("Draft exceeds limit");
    return result.trimStart();
  } finally {
    await handle.close();
  }
}
