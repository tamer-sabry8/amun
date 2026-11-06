import { patchFirstmatePermissions } from "../packages/crew/src/firstmate-policy-patch.ts";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  rename,
  writeFile,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { verifyDistributionArchive } from "../packages/crew/src/distribution.ts";
import { assertRuntimeContained } from "../packages/crew/src/runtime-links.ts";

const manifest = JSON.parse(
  await readFile("runtime/firstmate/manifest.json", "utf8"),
) as { archiveUrl: string; sha256: string; commit: string };
if (
  !/^[a-f0-9]{40}$/.test(manifest.commit) ||
  manifest.archiveUrl !==
    `https://codeload.github.com/kunchenguid/firstmate/tar.gz/${manifest.commit}`
)
  throw new Error("Invalid pinned Firstmate source");
const parent = resolve("apps/desktop/.runtime");
await mkdir(parent, { recursive: true });
const temporary = await mkdtemp(join(parent, "firstmate-stage-"));
try {
  const archive = join(temporary, "source.tar.gz");
  execFileSync(
    "curl",
    [
      "--fail",
      "--silent",
      "--show-error",
      "--location",
      "--max-time",
      "60",
      manifest.archiveUrl,
      "--output",
      archive,
    ],
    { stdio: "inherit" },
  );
  verifyDistributionArchive(await readFile(archive), manifest.sha256);
  const distribution = join(temporary, "distribution");
  await mkdir(distribution);
  execFileSync("tar", [
    "-xzf",
    archive,
    "--strip-components=1",
    "-C",
    distribution,
  ]);
  await assertRuntimeContained(distribution);
  await readFile(join(distribution, ".pi/extensions/fm-primary-pi-watch.ts"));
  const policy = join(distribution, "bin/fm-config-inherit-lib.sh");
  await writeFile(
    policy,
    patchFirstmatePermissions(
      await readFile(policy, "utf8"),
      "e76b7896b018ee6e31e564f3660e5698b7a135dabbe28b730c62690dc3fc0f0a",
    ),
  );
  // This fixed, ignored path contains generated distribution files only, never user homes.
  const destination = join(parent, "firstmate");
  await rm(destination, { recursive: true, force: true });
  await rename(distribution, destination);
  console.log(
    `Firstmate ${manifest.commit}: archive checksum, extracted link containment and Amun permission patch verified`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
