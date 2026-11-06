import { afterEach, describe, expect, it } from "vitest";
import {
  realpath,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManagedHome, mergeOverlay } from "../src/managed-home.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function temporary() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "amun-home-test-")));
  roots.push(root);
  return root;
}

describe("Firstmate managed home", () => {
  it("forces auto permissions without changing the imported values", () => {
    const overlay = {
      backend: "tmux",
      "claude-permission-mode": "bypass",
      "secondmate-harness": "codex",
      "crew-dispatch.json": '{"default":{"harness":"codex"}}',
    };
    expect(mergeOverlay(overlay)).toEqual({
      ...overlay,
      "claude-permission-mode": "auto",
    });
    expect(overlay["claude-permission-mode"]).toBe("bypass");
  });
  it.each([
    { backend: "unsupported" },
    { "../auth.json": "secret" },
    { "crew-dispatch.json": "broken" },
    { "crew-dispatch.json": "[]" },
  ])("rejects unsupported imports %#", (overlay) => {
    expect(() => mergeOverlay(overlay)).toThrow();
  });
  it("creates private operational directories and refuses to overwrite an existing home", async () => {
    const root = await temporary();
    const home = await createManagedHome(root, "primary", {});
    expect(
      await readFile(join(home, "config/claude-permission-mode"), "utf8"),
    ).toBe("auto\n");
    expect((await stat(home)).mode & 0o777).toBe(0o700);
    expect((await stat(join(home, "config/backend"))).mode & 0o777).toBe(0o600);
    for (const directory of ["state", "data", "projects"])
      expect((await stat(join(home, directory))).isDirectory()).toBe(true);
    await writeFile(join(home, "data/user-note"), "preserve me");
    await expect(createManagedHome(root, "primary", {})).rejects.toThrow();
    expect(await readFile(join(home, "data/user-note"), "utf8")).toBe(
      "preserve me",
    );
  });
  it.each(["../personal", "/personal", ".", "a/b", ""])(
    "rejects unsafe home name %j",
    async (name) => {
      await expect(
        createManagedHome(await temporary(), name, {}),
      ).rejects.toThrow();
    },
  );
  it("refuses a symlinked app-support root", async () => {
    const root = await temporary();
    await mkdir(join(root, "personal"));
    await symlink(join(root, "personal"), join(root, "redirect"));
    await expect(
      createManagedHome(join(root, "redirect"), "primary", {}),
    ).rejects.toThrow();
  });
});
