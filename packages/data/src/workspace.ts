import {
  constants,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  chmodSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import type Database from "better-sqlite3";
import { migrate } from "./database.ts";

function inspect(path: string, directory = false): boolean {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (
    stat.isSymbolicLink() ||
    (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) ||
    (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new Error("Unsafe workspace storage");
  return true;
}
/** root comes exclusively from Electron main's userData directory, never renderer input. */
export function openWorkspace(
  root: string,
  Native: typeof Database,
): Database.Database {
  if (!isAbsolute(root)) throw new Error("Workspace path must be absolute");
  if (!inspect(root, true)) mkdirSync(root, { mode: 0o700 });
  const file = join(root, "workspace.sqlite");
  for (const suffix of ["", "-wal", "-shm", "-journal"]) inspect(file + suffix);
  if (!inspect(file)) {
    const fd = openSync(
      file,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    closeSync(fd);
  }
  const db = new Native(file);
  try {
    migrate(db);
    db.pragma("journal_mode = WAL");
    // SQLite inherits the database permissions for WAL/SHM. Recheck before use.
    for (const suffix of ["", "-wal", "-shm"])
      if (inspect(file + suffix)) chmodSync(file + suffix, 0o600);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
