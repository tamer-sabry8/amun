import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, realpath, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createManagedHome } from "../packages/crew/src/managed-home.ts";
const root = await realpath(await mkdtemp(join(tmpdir(), "amun-permissions-")));
const packaged = process.argv.includes("--packaged");
try {
  const distribution = packaged
    ? resolve(
        `apps/desktop/out/Amun-darwin-${process.arch}/Amun.app/Contents/Resources/firstmate`,
      )
    : resolve("apps/desktop/.runtime/firstmate");
  const parent = await createManagedHome(root, "parent", { backend: "tmux" });
  const child = await createManagedHome(root, "child", { backend: "tmux" });
  // Seed deliberately wrong child values to prove actual upstream convergence, not our home creator.
  for (const name of ["claude-permission-mode", "codex-permission-mode"])
    await writeFile(join(child, "config", name), "bypass\n");
  await promisify(execFile)(
    "/bin/bash",
    [
      "-c",
      '. "$1"; propagate_inheritable_config "$2" "$3"',
      "amun-permission-proof",
      join(distribution, "bin/fm-config-inherit-lib.sh"),
      join(parent, "config"),
      join(child, "config"),
    ],
    {
      env: {
        HOME: root,
        PATH: "/usr/bin:/bin",
        FM_HOME: parent,
        FM_ROOT_OVERRIDE: distribution,
      },
      cwd: root,
      timeout: 15000,
      maxBuffer: 65536,
    },
  );
  const claude = (
    await readFile(join(child, "config/claude-permission-mode"), "utf8")
  ).trim();
  const codex = (
    await readFile(join(child, "config/codex-permission-mode"), "utf8")
  ).trim();
  const pass = claude === "auto" && codex === "restricted";
  console.log(
    JSON.stringify({
      packaged,
      claude,
      codex,
      propagated: pass,
      workerDispatches: 0,
      personalHomesAccessed: false,
    }),
  );
  if (!pass) process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
}
