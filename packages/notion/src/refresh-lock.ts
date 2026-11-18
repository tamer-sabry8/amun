// The credential store the Notion connection uses, and the lock that keeps
// two processes from refreshing the same sign-in at once (from Amun Beta
// 0.9's auth broker; only what the Notion connection needs).
import * as filesystem from "node:fs";
import { lstat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import lockfile from "proper-lockfile";

export interface Keyring {
  get(account: string): string | undefined;
  set(account: string, value: string): void;
  delete(account: string): void;
}

export async function withRefreshLock<T>(
  root: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!isAbsolute(root)) throw Error("Auth root must be absolute");
  const stat = await lstat(root);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw Error("Unsafe auth root");
  const release = await lockfile.lock(root, {
    fs: { ...filesystem },
    lockfilePath: join(root, ".amun-refresh.lock"),
    stale: 30000,
    update: 5000,
    retries: { retries: 30, minTimeout: 25, maxTimeout: 100, factor: 1.1 },
  });
  try {
    return await operation();
  } finally {
    await release();
  }
}
