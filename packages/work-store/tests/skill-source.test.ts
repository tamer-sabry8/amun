import { it, expect } from "vitest";
import { openDatabase } from "../src/sqlite.ts";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../src/database.ts";
import { WorkspaceService } from "../src/workspace-service.ts";
import { discoverSkills, gitUrl, skillName } from "../src/skill-source.ts";

it("accepts only plain public https addresses", () => {
  expect(gitUrl("https://github.com/o/skills.git").hostname).toBe("github.com");
  for (const bad of [
    "http://github.com/o/s",
    "git@github.com:o/s.git",
    "file:///tmp/skills",
    "https://user:pw@github.com/o/s",
    "https://localhost/o/s",
    "https://127.0.0.1/o/s",
    "https://github.com:8443/o/s",
    "not a url",
  ])
    expect(() => gitUrl(bad), bad).toThrow();
  expect(skillName("Release_Notes.git")).toBe("release-notes");
  expect(skillName("1abc")).toBe("");
});

it("finds skills, skipping links, big files and .git", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-skills-"));
  try {
    await mkdir(join(root, "a-skill"));
    await writeFile(join(root, "a-skill", "SKILL.md"), "Do a thing.");
    await mkdir(join(root, "big"));
    await writeFile(join(root, "big", "SKILL.md"), "x".repeat(13000));
    await mkdir(join(root, ".git"));
    await writeFile(join(root, ".git", "SKILL.md"), "hidden");
    await mkdir(join(root, "linked"));
    await symlink(
      join(root, "a-skill", "SKILL.md"),
      join(root, "linked", "SKILL.md"),
    );
    await writeFile(join(root, "SKILL.md"), "Root skill.");
    const found = await discoverSkills(root, "My_Repo");
    expect(found.map((s) => [s.name, s.path])).toEqual([
      ["a-skill", "a-skill/SKILL.md"],
      ["my-repo", "SKILL.md"],
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("queues fetched skills for review and uninstalls approved ones", async () => {
  const db = openDatabase(":memory:");
  migrate(db);
  try {
    db.exec(
      `INSERT INTO products(id,name,created_at) VALUES('p','Atlas','now'); INSERT INTO workspace_settings VALUES('ui_preferences','{"productId":"p"}');`,
    );
    const service = new WorkspaceService(db, undefined, "/unused");
    const request = { version: 1, kind: "skill-fetch", productId: "p" };
    const reply = await service.fetchSkills(
      { ...request, url: "https://example.com/o/s" },
      async () => ({
        origin: "https://example.com/o/s",
        skills: [{ name: "notes", path: "notes/SKILL.md", source: "Cite." }],
      }),
    );
    expect(reply.kind).toBe("workspace-snapshot");
    const [review] = service.skillLibrary.reviews("p") as {
      id: string;
      digest: string;
      origin: string;
    }[];
    expect(review?.origin).toBe("https://example.com/o/s#notes/SKILL.md");
    expect(service.skillLibrary.installed("p")).toEqual([]);
    service.skillLibrary.decide("p", review!.id, review!.digest, true);
    expect(service.skillLibrary.installed("p")).toHaveLength(1);
    const bad = await service.fetchSkills({
      ...request,
      url: "http://example.com/o/s",
    });
    expect(bad.kind).toBe("workspace-error");
    service.handle({
      version: 1,
      kind: "workspace",
      action: "remove-skill",
      productId: "p",
      name: "notes",
    });
    expect(service.skillLibrary.installed("p")).toEqual([]);
    expect(() =>
      service.skillLibrary.use("p", "notes", review!.digest),
    ).toThrow();
  } finally {
    db.close();
  }
});
