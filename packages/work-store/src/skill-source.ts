import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";

export class SkillSourceError extends Error {}

export interface FoundSkill {
  name: string;
  path: string;
  source: string;
}

const maxSkills = 50,
  maxDepth = 4,
  maxBytes = 12000;

/** Only plain https addresses: no credentials, ports, or local hosts. */
export function gitUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new SkillSourceError("Enter a web address that starts with https://");
  }
  const host = url.hostname;
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !host.includes(".") ||
    /^[\d.]+$/.test(host) ||
    host.startsWith("[") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "localhost"
  )
    throw new SkillSourceError(
      "Use a public https:// address, without a password or port.",
    );
  return url;
}

export const skillName = (folder: string) => {
  const name = folder
    .toLowerCase()
    .replace(/\.git$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return /^[a-z]/.test(name) ? name : "";
};

/** Finds SKILL.md files. Symbolic links and oversized files are skipped. */
export async function discoverSkills(
  root: string,
  fallbackName: string,
): Promise<FoundSkill[]> {
  const found: FoundSkill[] = [];
  const walk = async (dir: string, parts: string[]) => {
    if (found.length >= maxSkills || parts.length > maxDepth) return;
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (found.length >= maxSkills) return;
      if (entry.isDirectory() && entry.name !== ".git")
        await walk(join(dir, entry.name), [...parts, entry.name]);
      else if (entry.isFile() && entry.name === "SKILL.md") {
        const file = join(dir, entry.name);
        const info = await lstat(file);
        if (info.isSymbolicLink() || info.size > maxBytes) continue;
        const source = await readFile(file, "utf8");
        const name = skillName(parts.at(-1) ?? fallbackName);
        if (!name || !source.trim() || source.includes("\0")) continue;
        found.push({ name, path: [...parts, entry.name].join("/"), source });
      }
    }
  };
  await walk(root, []);
  return found;
}

const git = promisify(execFile);

/** Clones into Amun's own store, replacing an earlier copy of the same address. */
export async function cloneSkills(
  address: string,
  store: string,
): Promise<{ origin: string; skills: FoundSkill[] }> {
  const url = gitUrl(address);
  const clean = url.origin + url.pathname.replace(/\/+$/, "");
  const target = join(
    store,
    createHash("sha256").update(clean).digest("hex").slice(0, 16),
  );
  await mkdir(store, { recursive: true, mode: 0o700 });
  await rm(target, { recursive: true, force: true });
  try {
    await git(
      "git",
      [
        "-c",
        "protocol.allow=never",
        "-c",
        "protocol.https.allow=always",
        "-c",
        "core.symlinks=false",
        "-c",
        "core.hooksPath=/dev/null",
        "clone",
        "--depth=1",
        "--no-tags",
        "--single-branch",
        "--",
        clean,
        target,
      ],
      {
        timeout: 60_000,
        maxBuffer: 1 << 20,
        env: {
          PATH: process.env.PATH,
          HOME: store,
          GIT_TERMINAL_PROMPT: "0",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
        },
      },
    );
  } catch {
    await rm(target, { recursive: true, force: true });
    throw new SkillSourceError(
      "Could not get that address. Check it is public and try again.",
    );
  }
  const skills = await discoverSkills(
    target,
    basename(url.pathname).replace(/\.git$/, ""),
  );
  if (!skills.length)
    throw new SkillSourceError("No skills (SKILL.md files) found there.");
  return { origin: clean, skills };
}
