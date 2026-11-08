import { opendir, open, lstat, realpath, link, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { join } from "node:path";
import {
  endpointReceipt,
  type EndpointReceipt,
} from "../../contracts/src/crew.ts";
const maxReceiptBytes = 8192;

async function privateRoot(root: string): Promise<void> {
  const entry = await lstat(root);
  if (
    (await realpath(root)) !== root ||
    !entry.isDirectory() ||
    entry.isSymbolicLink() ||
    (entry.mode & 0o777) !== 0o700 ||
    entry.uid !== process.getuid?.()
  )
    throw new Error("Unsafe receipt root");
}
export async function saveEndpointReceipt(
  root: string,
  input: unknown,
): Promise<void> {
  const receipt = endpointReceipt.parse(input);
  await privateRoot(root);
  const bytes = JSON.stringify(receipt);
  if (Buffer.byteLength(bytes) > maxReceiptBytes)
    throw Error("Oversized endpoint receipt");
  const staged = join(root, "." + randomUUID() + ".pending");
  const file = await open(staged, "wx", 0o600);
  try {
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    // Publish complete bytes without replacing an existing worker's identity.
    await link(staged, join(root, receipt.identity.taskId + ".json"));
    const directory = await open(root, constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await unlink(staged);
  }
}
export async function readBoundedPrivateFile(
  path: string,
  maxBytes: number,
): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const entry = await file.stat();
    if (
      !entry.isFile() ||
      entry.uid !== process.getuid?.() ||
      (entry.mode & 0o077) !== 0 ||
      entry.size > maxBytes
    )
      throw new Error("Unsafe state file");
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) throw new Error("Oversized state file");
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await file.close();
  }
}
export async function loadEndpointReceipt(
  root: string,
  taskId: string,
): Promise<EndpointReceipt> {
  if (!/^[-a-zA-Z0-9_]{1,64}$/.test(taskId))
    throw new Error("Invalid task identity");
  await privateRoot(root);
  const receipt = endpointReceipt.parse(
    JSON.parse(
      await readBoundedPrivateFile(
        join(root, taskId + ".json"),
        maxReceiptBytes,
      ),
    ),
  );
  if (receipt.identity.taskId !== taskId)
    throw new Error("Receipt identity mismatch");
  return receipt;
}

export async function listReceiptTasks(root: string) {
  try {
    await privateRoot(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const ids: string[] = [];
  let scanned = 0;
  for await (const entry of await opendir(root)) {
    if (++scanned > 512) throw Error("Receipt inventory exceeds limit");
    if (!entry.isFile() || !/^[-a-zA-Z0-9_]{1,64}\.json$/.test(entry.name))
      continue;
    const id = entry.name.slice(0, -5);
    await loadEndpointReceipt(root, id);
    ids.push(id);
  }
  return ids.sort();
}
