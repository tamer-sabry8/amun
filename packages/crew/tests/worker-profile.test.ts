import { it, expect } from "vitest";
import {
  mkdtemp,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
  readFile,
  mkdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareWorkerProfile } from "../src/worker-profile.ts";
it("creates only private profile directories and preserves existing files", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "amun-worker-profile-")),
  );
  try {
    await prepareWorkerProfile(join(root, "profiles"), "codex");
    const profile = join(root, "profiles", "m0-codex");
    for (const part of ["", "home", "state", "work"])
      expect((await stat(join(profile, part))).mode & 0o777).toBe(0o700);
    const auth = join(profile, "state", "auth.json");
    await writeFile(auth, "existing");
    await prepareWorkerProfile(join(root, "profiles"), "codex");
    expect(await readFile(auth, "utf8")).toBe("existing");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("refuses foreign links, unsafe permissions and invalid tool selection", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "amun-worker-profile-")),
  );
  try {
    const base = join(root, "profiles");
    await mkdir(base, { mode: 0o700 });
    await mkdir(join(root, "foreign"));
    await symlink(join(root, "foreign"), join(base, "m0-codex"));
    await expect(prepareWorkerProfile(base, "codex")).rejects.toThrow();
    await expect(
      prepareWorkerProfile(base, "other" as never),
    ).rejects.toThrow();
    await mkdir(join(base, "m0-claude"), { mode: 0o755 });
    await expect(prepareWorkerProfile(base, "claude")).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("provisions a separately named Amun profile without touching the signed-in default", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "amun-separate-worker-")),
  );
  try {
    const base = join(root, "profiles");
    const original = await prepareWorkerProfile(base, "codex");
    await writeFile(join(original, "state", "sentinel"), "preserved");
    const id = "11111111-1111-4111-8111-111111111111";
    const isolated = await prepareWorkerProfile(base, "codex", id);
    expect(isolated).not.toBe(original);
    expect(await readFile(join(original, "state", "sentinel"), "utf8")).toBe(
      "preserved",
    );
    for (const invalid of ["../personal", "m0", "", "x".repeat(512)])
      await expect(
        prepareWorkerProfile(base, "claude", invalid),
      ).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
