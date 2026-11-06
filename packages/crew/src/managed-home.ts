import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const allowed = new Set([
  "backend",
  "claude-permission-mode",
  "secondmate-harness",
  "crew-dispatch.json",
]);
/** Only explicit operational configuration is imported; credentials and executable skills are excluded. */
export function mergeOverlay(
  overlay: Record<string, string>,
): Record<string, string> {
  for (const [key, value] of Object.entries(overlay)) {
    if (
      !allowed.has(key) ||
      typeof value !== "string" ||
      Buffer.byteLength(value) > 65536
    )
      throw new Error("Unsupported overlay");
  }
  const merged = {
    backend: "herdr",
    "secondmate-harness": "codex",
    ...overlay,
    "claude-permission-mode": "auto",
  };
  if (!["herdr", "tmux"].includes(merged.backend.trim()))
    throw new Error("Unsupported backend");
  if (overlay["crew-dispatch.json"] !== undefined) {
    const dispatch: unknown = JSON.parse(overlay["crew-dispatch.json"]);
    if (!dispatch || typeof dispatch !== "object" || Array.isArray(dispatch))
      throw new Error("Invalid dispatch configuration");
  }
  return merged;
}

export async function createManagedHome(
  appSupportRoot: string,
  name: string,
  overlay: Record<string, string>,
): Promise<string> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name))
    throw new Error("Invalid managed home name");
  const config = mergeOverlay(overlay);
  const root = resolve(appSupportRoot);
  // Caller supplies an existing app-owned directory. Refuse symlinks in its ancestry.
  for (let current = root; ; current = dirname(current)) {
    const entry = await lstat(current);
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw new Error("Unsafe app-support directory");
    if (dirname(current) === current) break;
  }
  const home = join(root, name);
  await mkdir(home, { mode: 0o700 }); // exclusive: never merge into or overwrite an existing home
  for (const directory of ["config", "state", "data", "projects"])
    await mkdir(join(home, directory), { mode: 0o700 });
  for (const [key, value] of Object.entries(config)) {
    await writeFile(join(home, "config", key), `${value.trim()}\n`, {
      mode: 0o600,
      flag: "wx",
    });
  }
  return home;
}
