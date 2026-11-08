import { it, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
  lstat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  createFirstmateWorktrees,
  ownedWorktreeBranch,
} from "../src/firstmate-worktree.ts";
it("provisions genuine separate worktrees from a snapshot without adopting an ancestor repository", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "amun-worktree-test-")),
  );
  try {
    const source = join(root, "source");
    await mkdir(source);
    await mkdir(join(source, "bin"));
    await writeFile(join(source, "AGENTS.md"), "Fixture only");
    await writeFile(join(source, "bin/tool"), "fixture");
    const target = join(root, "owned");
    const result = await createFirstmateWorktrees(source, target, [
      "primary",
      "worker",
    ]);
    for (const home of Object.values(result.homes)) {
      expect((await lstat(join(home, ".git"))).isFile()).toBe(true);
      expect(
        execFileSync(
          "/usr/bin/git",
          ["-C", home, "rev-parse", "--show-toplevel"],
          { encoding: "utf8" },
        ).trim(),
      ).toBe(home);
      expect(await readFile(join(home, "bin/tool"), "utf8")).toBe("fixture");
    }
    expect(
      execFileSync(
        "/usr/bin/git",
        ["-C", result.repository, "worktree", "list", "--porcelain"],
        { encoding: "utf8" },
      ),
    ).toContain(result.homes.worker);
    await expect(
      createFirstmateWorktrees(source, target, ["other"]),
    ).rejects.toThrow();
    expect(
      await ownedWorktreeBranch(result.homes.primary!, result.homes.worker!),
    ).toBe("amun/worker");
    const marker = await readFile(join(result.homes.worker!, ".git"));
    const foreign = await createFirstmateWorktrees(
      source,
      join(root, "foreign"),
      ["primary", "worker"],
    );
    await writeFile(
      join(result.homes.worker!, ".git"),
      await readFile(join(foreign.homes.worker!, ".git")),
    );
    await expect(
      ownedWorktreeBranch(result.homes.primary!, result.homes.worker!),
    ).rejects.toThrow();
    await writeFile(join(result.homes.worker!, ".git"), marker);
    await writeFile(
      join(result.repository, "worktrees", "worker", "gitdir"),
      join(foreign.homes.worker!, ".git"),
    );
    await expect(
      ownedWorktreeBranch(result.homes.primary!, result.homes.worker!),
    ).rejects.toThrow();
    expect(await readFile(join(source, "AGENTS.md"), "utf8")).toBe(
      "Fixture only",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("refuses unsafe or duplicate names before creating state", async () => {
  for (const names of [["../personal"], ["same", "same"], [], [".git"]])
    await expect(
      createFirstmateWorktrees("/unused", "/unused", names),
    ).rejects.toThrow();
});
