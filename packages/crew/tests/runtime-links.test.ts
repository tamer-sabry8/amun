import { afterEach, expect, it } from "vitest";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  repairRuntimeLinks,
  assertRuntimeContained,
} from "../src/runtime-links.js";
let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
it("repairs copied links and remains usable after the build source is removed", async () => {
  root = await mkdtemp(join(tmpdir(), "amun-links-"));
  const source = join(root, "source");
  const target = join(root, "target");
  await mkdir(join(source, "store"), { recursive: true });
  await writeFile(join(source, "store/runtime.js"), "runtime");
  await symlink("store/runtime.js", join(source, "entry.js"));
  await cp(source, target, { recursive: true });
  await expect(assertRuntimeContained(target)).rejects.toThrow();
  await repairRuntimeLinks(source, target);
  await rm(source, { recursive: true });
  await expect(assertRuntimeContained(target)).resolves.toBeUndefined();
  expect(await readFile(join(target, "entry.js"), "utf8")).toBe("runtime");
});
it("refuses an upstream dependency that escapes the staged runtime", async () => {
  root = await mkdtemp(join(tmpdir(), "amun-links-"));
  await mkdir(join(root, "source"));
  await writeFile(join(root, "outside"), "private");
  await symlink("../outside", join(root, "source/entry"));
  await expect(
    repairRuntimeLinks(join(root, "source"), join(root, "target")),
  ).rejects.toThrow();
});

it("removes only the verified pnpm deployment self-reference", async () => {
  const { removeDeploymentSelfLink } = await import("../src/runtime-links.js");
  root = await mkdtemp(join(tmpdir(), "amun-links-"));
  const staged = join(root, "stage");
  const project = join(root, "project");
  await mkdir(join(staged, "node_modules/.pnpm/node_modules/@amun"), {
    recursive: true,
  });
  await mkdir(project);
  const link = join(staged, "node_modules/.pnpm/node_modules/@amun/pi-runtime");
  await symlink(project, link);
  await removeDeploymentSelfLink(staged, project);
  await expect(assertRuntimeContained(staged)).resolves.toBeUndefined();
  await symlink(root, link);
  await expect(removeDeploymentSelfLink(staged, project)).rejects.toThrow();
});

it("removes only the verified terminal deployment self-reference", async () => {
  const { removeDeploymentSelfLink } = await import("../src/runtime-links.js");
  root = await mkdtemp(join(tmpdir(), "amun-links-"));
  const staged = join(root, "stage");
  const project = join(root, "project");
  await mkdir(join(staged, "node_modules/.pnpm/node_modules/@amun"), {
    recursive: true,
  });
  await mkdir(project);
  const link = join(
    staged,
    "node_modules/.pnpm/node_modules/@amun/terminal-runtime",
  );
  await symlink(project, link);
  await removeDeploymentSelfLink(staged, project, "terminal-runtime");
  await expect(assertRuntimeContained(staged)).resolves.toBeUndefined();
  await expect(
    removeDeploymentSelfLink(staged, project, "../../outside"),
  ).rejects.toThrow();
});

it("removes only the verified database deployment self-reference", async () => {
  const { removeDeploymentSelfLink } = await import("../src/runtime-links.js");
  root = await mkdtemp(join(tmpdir(), "amun-links-"));
  const staged = join(root, "stage");
  const project = join(root, "project");
  await mkdir(join(staged, "node_modules/.pnpm/node_modules/@amun"), {
    recursive: true,
  });
  await mkdir(project);
  const link = join(
    staged,
    "node_modules/.pnpm/node_modules/@amun/database-runtime",
  );
  await symlink(project, link);
  await removeDeploymentSelfLink(staged, project, "database-runtime");
  await expect(assertRuntimeContained(staged)).resolves.toBeUndefined();
  await expect(
    removeDeploymentSelfLink(staged, project, "../../outside"),
  ).rejects.toThrow();
});

it("removes only the verified auth deployment self-reference", async () => {
  const { removeDeploymentSelfLink } = await import("../src/runtime-links.js");
  root = await mkdtemp(join(tmpdir(), "amun-links-"));
  const staged = join(root, "stage");
  const project = join(root, "project");
  await mkdir(join(staged, "node_modules/.pnpm/node_modules/@amun"), {
    recursive: true,
  });
  await mkdir(project);
  const link = join(
    staged,
    "node_modules/.pnpm/node_modules/@amun/auth-runtime",
  );
  await symlink(project, link);
  await removeDeploymentSelfLink(staged, project, "auth-runtime");
  await expect(assertRuntimeContained(staged)).resolves.toBeUndefined();
  await expect(
    removeDeploymentSelfLink(staged, project, "../../outside"),
  ).rejects.toThrow();
});
