// Stages the pinned Council (Roast Room) upstream for the desktop app:
// download the exact commit archive, verify its checksum, unpack it into
// apps/desktop/.runtime/roast-room/<commit>/ and write pin.json beside it.
// Nothing from the archive is executed here. Amun composes its own working
// copy from this pristine one at first run (packages/council/src/runtime.ts).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

interface Pin {
  repository: string;
  commit: string;
  archiveUrl: string;
  sha256: string;
}
const pin = JSON.parse(
  await readFile("runtime/roast-room/manifest.json", "utf8"),
) as Pin;
if (
  pin.repository !== "https://github.com/nateherkai/roast-room" ||
  !/^[a-f0-9]{40}$/.test(pin.commit) ||
  !/^[a-f0-9]{64}$/.test(pin.sha256) ||
  pin.archiveUrl !==
    `https://codeload.github.com/nateherkai/roast-room/tar.gz/${pin.commit}`
)
  throw Error("Invalid pinned Roast Room source");

const parent = resolve("apps/desktop/.runtime/roast-room");
const target = join(parent, pin.commit);
const required = [
  ".claude/skills/roast-room/roster.json",
  ".claude/skills/roast-room/SKILL.md",
  "app/server.mjs",
];
await mkdir(parent, { recursive: true });
if (!required.every((file) => existsSync(join(target, file)))) {
  const temporary = await mkdtemp(join(parent, "stage-"));
  try {
    const archive = join(temporary, "source.tgz");
    execFileSync(
      "curl",
      [
        "--fail",
        "--silent",
        "--show-error",
        "--location",
        "--max-time",
        "120",
        pin.archiveUrl,
        "--output",
        archive,
      ],
      { stdio: "inherit" },
    );
    const digest = createHash("sha256")
      .update(await readFile(archive))
      .digest("hex");
    if (digest !== pin.sha256)
      throw Error("Roast Room archive does not match its pinned checksum");
    const unpacked = join(temporary, "unpacked");
    await mkdir(unpacked);
    execFileSync("tar", [
      "-xzf",
      archive,
      "-C",
      unpacked,
      "--strip-components=1",
      "--no-same-owner",
    ]);
    for (const file of required)
      if (!existsSync(join(unpacked, file)))
        throw Error("Roast Room archive is missing " + file);
    await rm(target, { recursive: true, force: true });
    await rename(unpacked, target);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
await writeFile(
  join(parent, "pin.json"),
  JSON.stringify(
    { repository: pin.repository, commit: pin.commit, sha256: pin.sha256 },
    null,
    2,
  ) + "\n",
);
console.log("Roast Room staged at " + pin.commit.slice(0, 7));
