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

type Pin = { archiveUrl: string; sha256: string; commit: string };
const readPin = async (name: string): Promise<Pin> => {
  const pin = JSON.parse(
    await readFile(join("runtime/firstmate", name), "utf8"),
  ) as Pin;
  if (
    !/^[a-f0-9]{40}$/.test(pin.commit) ||
    !/^[a-f0-9]{64}$/.test(pin.sha256) ||
    pin.archiveUrl !==
      `https://codeload.github.com/kunchenguid/firstmate/tar.gz/${pin.commit}`
  )
    throw Error("Invalid pinned Firstmate source");
  return pin;
};
const manifest = await readPin("manifest.json");
const previous = await readPin("previous.json");
if (previous.commit === manifest.commit)
  throw Error("Duplicate Firstmate release pins");
const parent = resolve("apps/desktop/.runtime");
await mkdir(parent, { recursive: true });
const archives = join(parent, "firstmate-archives");
await mkdir(archives, { recursive: true });
const temporary = await mkdtemp(join(parent, "firstmate-stage-"));
async function retain(pin: Pin) {
  const path = join(archives, pin.commit + ".tgz");
  try {
    verifyDistributionArchive(await readFile(path), pin.sha256);
    return path;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const download = join(temporary, pin.commit + ".tgz");
  execFileSync(
    "curl",
    [
      "--fail",
      "--silent",
      "--show-error",
      "--location",
      "--max-time",
      "60",
      pin.archiveUrl,
      "--output",
      download,
    ],
    { stdio: "inherit" },
  );
  verifyDistributionArchive(await readFile(download), pin.sha256);
  await rename(download, path);
  return path;
}
try {
  const archive = await retain(manifest);
  await retain(previous);
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
  const catalog = join(temporary, "catalog.json");
  await writeFile(catalog, JSON.stringify({ current: manifest, previous }));
  await rename(catalog, join(archives, "catalog.json"));
  console.log(
    `Firstmate ${manifest.commit}: archive checksum, extracted link containment and Amun permission patch verified`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
