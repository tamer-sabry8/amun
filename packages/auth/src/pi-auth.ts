import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { modelLoginOptions } from "./broker.ts";
export function validateLogin(provider: string, type: string): void {
  if (
    !modelLoginOptions.some(
      (option) => option.provider === provider && option.type === type,
    )
  )
    throw Error("Unsupported provider login");
}
export function authBrowserUrl(provider: string, value: string): string {
  if (value.length > 8192) throw Error("Invalid auth URL");
  const url = new URL(value);
  const hosts: Record<string, readonly string[]> = {
    "github-copilot": ["github.com"],
    openrouter: ["openrouter.ai"],
    "openai-codex": ["auth.openai.com"],
  };
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !hosts[provider]?.includes(url.hostname)
  )
    throw Error("Unsupported auth browser destination");
  return url.href;
}
async function inspect(path: string, directory: boolean): Promise<boolean> {
  let stat;
  try {
    stat = await lstat(path);
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
    throw Error("Unsafe Pi auth storage");
  return true;
}
export async function preparePiAuth(root: string): Promise<string> {
  if (!isAbsolute(root)) throw Error("Pi auth root must be absolute");
  if (!(await inspect(root, true))) await mkdir(root, { mode: 0o700 });
  const path = join(root, "auth.json");
  if (!(await inspect(path, false))) {
    const file = await open(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile("{}");
    } finally {
      await file.close();
    }
  }
  return path;
}
export function parseReadiness(
  provider: string,
  output: string,
): "configured" | "missing" | "error" {
  try {
    if (output.length > 65536) throw Error();
    const data: unknown = JSON.parse(output);
    if (
      !data ||
      typeof data !== "object" ||
      !("provider" in data) ||
      data.provider !== provider ||
      "credentials" in data ||
      !("status" in data)
    )
      throw Error();
    if (data.status === "ready") return "configured";
    if (data.status === "missing" || data.status === "unconfigured")
      return "missing";
    return "error";
  } catch {
    return "error";
  }
}
