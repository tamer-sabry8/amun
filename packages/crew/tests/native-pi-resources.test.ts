import { expect, it } from "vitest";
import {
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resourceDirectories,
  resourceNames,
  expandResource,
} from "../src/native-pi-resources.ts";
it("reads owner-created skill data inside the private profile and rejects symlinks, reserved names and unknown commands", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "amun-resource-test-")),
  );
  try {
    const { prompts, skills } = await resourceDirectories(root);
    const filePath = join(skills, "SKILL.md");
    await writeFile(filePath, "Review the decision.");
    await chmod(filePath, 0o644);
    const session = {
      sessionId: "test",
      promptTemplates: [{ name: "share", content: "reserved", filePath: "" }],
      resourceLoader: {
        getSkills: () => ({
          skills: [{ name: "review", filePath, baseDir: skills }],
        }),
      },
    };
    expect(resourceNames(session)).toEqual(["skill:review"]);
    const expand = (name: string) =>
      expandResource(
        session,
        root,
        name,
        "",
        () => "",
        (text) => text,
      );
    await expect(expand("skill:review")).resolves.toContain(
      "Review the decision.",
    );
    await expect(expand("missing")).rejects.toThrow();
    await symlink(join(root, "missing"), join(prompts, "unsafe.md"));
    await expect(resourceDirectories(root)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
