import {
  lstat,
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createFirstmateWorktrees } from "../packages/crew/src/firstmate-worktree.ts";
import { mergeOverlay } from "../packages/crew/src/managed-home.ts";
const source = process.argv[2];
if (!source)
  throw Error("Pass the explicitly selected existing Firstmate checkout");
const canonical = await realpath(source);
if (canonical !== resolve(source)) throw Error("Symlinked source refused");
const names = [
  "backend",
  "claude-permission-mode",
  "secondmate-harness",
  "crew-dispatch.json",
];
const read = async (path: string) => {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 65536)
    throw Error("Unsupported configuration file");
  return readFile(path, "utf8");
};
const values: Record<string, string> = {};
for (const name of names)
  values[name] = await read(join(source, "config", name));
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const before = Object.fromEntries(
  names.map((name) => [name, digest(values[name]!)]),
);
const distribution = resolve("apps/desktop/.runtime/firstmate");
const root = await realpath(
  await mkdtemp(join(tmpdir(), "amun-import-proof-")),
);
try {
  const created = await createFirstmateWorktrees(
    distribution,
    join(root, "git"),
    ["managed"],
  );
  const home = created.homes.managed!;
  // User explicitly selected tmux for Amun; do not import the personal Herdr backend.
  const overlay = mergeOverlay({ ...values, backend: "tmux" });
  await mkdir(join(home, "config"), { recursive: true, mode: 0o700 });
  for (const [name, value] of Object.entries(overlay))
    await writeFile(join(home, "config", name), value.trim() + "\n", {
      mode: 0o600,
    });
  for (const name of ["crew-dispatch.json", "secondmate-harness"])
    if (
      (await read(join(home, "config", name))).trim() !== values[name]!.trim()
    )
      throw Error("Import mismatch");
  const skillPaths = (
    await promisify(execFile)(
      "/usr/bin/git",
      ["-C", source, "ls-files", "-z", "--", ".agents/skills"],
      { maxBuffer: 1048576 },
    )
  ).stdout
    .split("\0")
    .filter(Boolean);
  let matchingSkills = 0;
  let matchingInternalLinks = 0;
  for (const path of skillPaths) {
    if (
      !(
        path.startsWith(".agents/skills/") || path.startsWith(".claude/mods/")
      ) ||
      path.split("/").includes("..")
    )
      throw Error("Invalid tracked skill path");
    const a = await lstat(join(source, path)),
      b = await lstat(join(home, path));
    if (a.isSymbolicLink() || b.isSymbolicLink()) {
      const sourceTarget = await realpath(join(source, path)),
        target = await realpath(join(home, path));
      if (
        !a.isSymbolicLink() ||
        !b.isSymbolicLink() ||
        !sourceTarget.startsWith(source + "/") ||
        !target.startsWith(home + "/") ||
        relative(source, sourceTarget) !== relative(home, target)
      )
        throw Error("Skill link escapes or differs");
      const referenced = (
        await promisify(execFile)(
          "/usr/bin/git",
          [
            "-C",
            source,
            "ls-files",
            "-z",
            "--",
            relative(source, sourceTarget),
          ],
          { maxBuffer: 1048576 },
        )
      ).stdout
        .split("\0")
        .filter(Boolean);
      for (const referencedPath of referenced)
        if (!skillPaths.includes(referencedPath))
          skillPaths.push(referencedPath);
      matchingInternalLinks++;
      continue;
    }
    if (!a.isFile() || !b.isFile())
      throw Error("Unsupported tracked skill entry");
    if (
      !(await readFile(join(source, path))).equals(
        await readFile(join(home, path)),
      )
    )
      throw Error("Tracked skill compatibility requires review");
    matchingSkills++;
  }
  for (const name of names)
    if (digest(await read(join(source, "config", name))) !== before[name])
      throw Error("Personal configuration changed");
  console.log(
    JSON.stringify({
      realGitWorktree: true,
      sourceBackend: "herdr",
      selectedAmunBackend: "tmux",
      configurationImported: ["crew-dispatch.json", "secondmate-harness"],
      claudePermissionMode: "auto",
      codexPermissionMode: "restricted",
      matchingTrackedSkillFiles: matchingSkills,
      matchingInternalSkillLinks: matchingInternalLinks,
      personalConfigurationUnchanged: true,
      importedConfigurationExecuted: false,
      credentialFilesRead: 0,
    }),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
