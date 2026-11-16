import { chmod, lstat, rename, writeFile, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { copilotProvider } from "./copilot-routing.ts";

export interface PiLauncherSource {
  /** Electron executable, run as Node. */
  binary: string;
  /** Bundled Pi CLI entry. */
  entry: string;
  /** Amun's Pi credential and settings root. */
  authRoot: string;
}
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
function absolute(path: unknown, label: string): string {
  if (
    typeof path !== "string" ||
    !isAbsolute(path) ||
    resolve(path) !== path ||
    /[\0\r\n]/.test(path)
  )
    throw Error("Unsafe Pi " + label);
  return path;
}
/** The launcher text. Paths are single-quoted so none can add shell syntax. */
export function piLauncherScript(source: PiLauncherSource): string {
  const binary = absolute(source.binary, "binary"),
    entry = absolute(source.entry, "entry"),
    root = absolute(source.authRoot, "credential root");
  return [
    "#!/bin/bash",
    "export ELECTRON_RUN_AS_NODE=1",
    "export PI_SKIP_VERSION_CHECK=1",
    "export PI_CODING_AGENT_DIR=" + quote(root),
    `exec ${quote(binary)} ${quote(entry)} --provider ${copilotProvider} "$@"`,
    "",
  ].join("\n");
}
/**
 * Writes `<directory>/pi`, which Firstmate resolves as the Pi harness. The
 * directory must already be a private Amun-owned folder; the file is replaced
 * atomically so a running worker never sees a partial script.
 */
export async function writePiLauncher(
  directory: string,
  source: PiLauncherSource,
): Promise<string> {
  absolute(directory, "launcher directory");
  const text = piLauncherScript(source);
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o077) !== 0
  )
    throw Error("Unsafe Pi launcher directory");
  const target = join(directory, "pi"),
    staged = join(directory, ".pi." + process.pid + ".tmp");
  try {
    await writeFile(staged, text, { mode: 0o700, flag: "wx", flush: true });
    await chmod(staged, 0o700);
    await rename(staged, target);
  } catch (error) {
    await rm(staged, { force: true });
    throw error;
  }
  return target;
}
