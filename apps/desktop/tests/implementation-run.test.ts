import { expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  acceptanceDb,
  acceptanceDrafts,
} from "../../../tests/support/ado-acceptance-drafts.ts";
import { WorkspaceService } from "../../../packages/data/src/workspace-service.ts";
import { implementationRun } from "../src/implementation-run.ts";
it("binds the story to one checkout, resumes its decision and verifies the provider PR head and branch", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "amun-delivery-run-")),
  );
  try {
    const context = await acceptanceDrafts(
      root,
      "https://example.test/",
      "Library",
    );
    const project = context.productId,
      story = context.storyDrafts.find((s) => !s.parentId)!.id;
    const checkout = join(root, "source"),
      url = "https://example.test/o/library";
    const git = (dir: string, ...args: string[]) =>
      execFileSync("/usr/bin/git", args, {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    git(root, "init", "-b", "main", checkout);
    git(
      checkout,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "--allow-empty",
      "-m",
      "Initialize",
    );
    git(checkout, "remote", "add", "origin", url);
    const db = acceptanceDb(root);
    try {
      const ws = new WorkspaceService(db);
      ws.handle({
        version: 1,
        kind: "workspace",
        action: "map-source",
        productId: project,
        sourceKind: "repo",
        title: "Library",
        reference: url,
      });
      const source = ws
        .snapshot()
        .productContext!.sources.find((x) => x.kind === "repo")!.id;
      const deliver = vi.fn(async () => ({
        identity: { taskId: "amun-codex", paneId: "%1" },
      }));
      let remote = { head: "b".repeat(40), sourceBranch: "main" };
      const send = (action: string, fields: Record<string, unknown>) =>
        implementationRun(
          {
            version: 1,
            kind: "crew-delivery",
            action,
            id: randomUUID(),
            product: project,
            story,
            ...fields,
          },
          db,
          root,
          () => project,
          deliver,
          async () => remote,
        );
      const preview = (await send("prepare", { source, checkout })).run!;
      expect(deliver).not.toHaveBeenCalled();
      const bound = { run: preview.scope.id, binding: preview.binding };
      await send("start", bound);
      await send("start", bound);
      expect(deliver).toHaveBeenCalledTimes(1);
      const report = join(dirname(preview.scope.worktree), "report.json");
      await writeFile(
        report,
        JSON.stringify({ state: "blocked", question: "Which label?" }),
        { mode: 0o600 },
      );
      await send("refresh", bound);
      const q = ws.snapshot().attention.find((i) => i.ask === "Which label?")!;
      expect(q.blocking).toContain(story);
      ws.handle({
        version: 1,
        kind: "workspace",
        action: "resolve",
        id: q.id,
        source: "review",
        answer: "Review",
      });
      await send("refresh", bound);
      expect(deliver).toHaveBeenCalledTimes(2);
      const head = git(checkout, "rev-parse", "HEAD");
      await writeFile(
        report,
        JSON.stringify({
          state: "pull_request",
          number: 7,
          head,
          tests: "Mac checks passed.",
        }),
      );
      await expect(send("refresh", bound)).rejects.toThrow(/changed/i);
      remote = { head, sourceBranch: preview.scope.branch };
      expect((await send("refresh", bound)).message).toContain(
        "Verified PR #7",
      );
      expect(
        db
          .prepare(
            "SELECT repo,number,head FROM delivery_pull_requests WHERE run_id=?",
          )
          .get(bound.run),
      ).toEqual({ repo: url, number: 7, head });
    } finally {
      db.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
