import { expect, it, onTestFinished } from "vitest";
import {
  mkdtemp,
  writeFile,
  mkdir,
  readFile,
  symlink,
  rm,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FirstmateReleases } from "../src/firstmate-release.ts";
import { createHash } from "node:crypto";

it("persists offline rollback, verifies retained bytes, and preserves previously selected worktrees", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "amun-release-test-")),
  );
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const archives = join(root, "archives");
  await mkdir(archives);
  const pins = ["a", "b"].map((v) => ({
    commit: v.repeat(40),
    sha256: createHash("sha256").update(v).digest("hex"),
  }));
  const [current, previous] = pins as [
    (typeof pins)[number],
    (typeof pins)[number],
  ];
  for (const p of pins)
    await writeFile(join(archives, p.commit + ".tgz"), p.commit[0]!);
  const path = join(root, "selection");
  const releases = new FirstmateReleases(path, archives, current, previous);
  expect(await releases.selected()).toEqual(current);
  await writeFile(join(archives, previous.commit + ".tgz"), "corrupt");
  await expect(releases.rollback()).rejects.toThrow();
  expect(await releases.selected()).toEqual(current);
  await writeFile(join(archives, previous.commit + ".tgz"), "b");
  await releases.rollback();
  expect(
    await new FirstmateReleases(path, archives, current, previous).selected(),
  ).toEqual(previous);
  expect(await readFile(join(archives, current.commit + ".tgz"), "utf8")).toBe(
    "a",
  );
  await writeFile(path, "unrecognized");
  await expect(releases.selected()).rejects.toThrow();
  await expect(
    new FirstmateReleases(path + "2", archives, current, null).rollback(),
  ).rejects.toThrow();
  await symlink(path, path + "3");
  await expect(
    new FirstmateReleases(path + "3", archives, current, previous).selected(),
  ).rejects.toThrow();
});
