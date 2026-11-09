import { it, expect } from "vitest";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  previewDeliveryTree,
  materializeDeliveryTree,
} from "../src/delivery-worktree.ts";
it("materializes exactly the reviewed commit in a separate writable branch and resumes that same checkout", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "amun-run-tree-")));
  try {
    const src = join(root, "source"),
      owned = join(root, "delivery");
    const run = (cwd: string, ...args: string[]) =>
      execFileSync("/usr/bin/git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    run(root, "init", "-b", "main", src);
    await writeFile(join(src, "README"), "Original");
    run(src, "add", "README");
    run(
      src,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-m",
      "Initial",
    );
    const remote = "https://example.test/owner/demo";
    run(src, "remote", "add", "origin", remote);
    const id = "05d51ae4-0ef7-44df-b412-766ca25b9242";
    await expect(
      previewDeliveryTree(owned, src, "https://example.test/owner/other", id),
    ).rejects.toThrow(/mapped/i);
    const scope = await previewDeliveryTree(owned, src, remote, id, "test");
    expect(scope.branch).toBe("test/story-" + id);
    expect(scope.head).toBe(run(src, "rev-parse", "HEAD"));
    const wt = await materializeDeliveryTree(owned, scope);
    expect(run(wt, "branch", "--show-current")).toBe(scope.branch);
    expect(run(wt, "rev-parse", "--git-common-dir")).not.toBe(
      run(src, "rev-parse", "--git-dir"),
    );
    await writeFile(join(wt, "WORK"), "In progress");
    expect(await materializeDeliveryTree(owned, scope)).toBe(wt);
    expect(run(src, "status", "--porcelain")).toBe("");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
