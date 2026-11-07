import { test, expect, _electron as electron } from "@playwright/test";
import {
  realpathSync,
  mkdtempSync,
  mkdirSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { migrate, schemaVersion } from "../../packages/data/src/database.ts";
const Database = createRequire(resolve("packages/data/package.json"))(
  "better-sqlite3",
);
test("service upgrades prior workspace data and preserves it across app restarts", async () => {
  const root = mkdtempSync(join(tmpdir(), "amun-upgrade-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace, { mode: 0o700 });
  const file = join(workspace, "workspace.sqlite");
  const old = new Database(file);
  migrate(old, 1);
  old
    .prepare("INSERT INTO products(id,name,created_at) VALUES (?,?,?)")
    .run("upgrade", "Upgrade survivor", "now");
  old.close();
  chmodSync(file, 0o600);
  try {
    for (let trial = 0; trial < 2; trial++) {
      const app = await electron.launch({
        args: [
          ...(process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"]),
          "--user-data-dir=" + root,
        ],
        ...(process.env.AMUN_PACKAGED_PATH
          ? { executablePath: process.env.AMUN_PACKAGED_PATH }
          : {}),
        chromiumSandbox: true,
      });
      try {
        const page = await app.firstWindow();
        await expect(page.getByRole("status")).toHaveText("Connected");
        expect(await app.evaluate(({ app }) => app.getPath("userData"))).toBe(
          realpathSync(root),
        );
      } finally {
        await app.close();
      }
      const upgraded = new Database(file, { readonly: true });
      expect(upgraded.pragma("user_version", { simple: true })).toBe(
        schemaVersion,
      );
      expect(
        upgraded.prepare("SELECT name FROM products WHERE id=?").get("upgrade"),
      ).toEqual({ name: "Upgrade survivor" });
      upgraded.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
