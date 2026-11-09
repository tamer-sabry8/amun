import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import {
  lstat,
  mkdir,
  open,
  mkdtemp,
  rm,
  writeFile,
  link,
} from "node:fs/promises";
export async function writeStakeholderPdf(
  root: string,
  id: string,
  title: string,
  text: string,
) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw Error("Invalid export ID");
  const path = join(root, "exports");
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o077) !== 0
  )
    throw Error("Unsafe export directory");
  const stage = await mkdtemp(join(path, ".render-"));
  try {
    const input = join(stage, "update.txt");
    await writeFile(input, title + "\n\n" + text, { mode: 0o600, flag: "wx" });
    const { stdout } = await promisify(execFile)(
      "/usr/sbin/cupsfilter",
      ["-i", "text/plain", "-m", "application/pdf", input],
      { encoding: "buffer", maxBuffer: 10_000_000, timeout: 15000 },
    );
    if (!stdout.subarray(0, 5).equals(Buffer.from("%PDF-")))
      throw Error("PDF unavailable");
    const tmp = join(stage, "update.pdf"),
      dest = join(path, id + ".pdf");
    const file = await open(tmp, "wx", 0o600);
    try {
      await file.writeFile(stdout);
      await file.sync();
    } finally {
      await file.close();
    }
    await link(tmp, dest);
    return dest;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
