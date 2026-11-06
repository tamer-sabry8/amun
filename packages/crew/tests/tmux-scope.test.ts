import { afterEach, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { createTmuxScope, tmuxEnvironment } from "../src/tmux-scope.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function root() {
  const p = await realpath(await mkdtemp("/tmp/amun-scope-test-"));
  roots.push(p);
  return p;
}
it("creates distinct private socket roots for independent homes", async () => {
  const parent = await root();
  const first = await createTmuxScope(parent);
  const second = await createTmuxScope(parent);
  expect(first).not.toBe(second);
  expect((await stat(first)).mode & 0o777).toBe(0o700);
  expect((await stat(second)).mode & 0o777).toBe(0o700);
});
it("rejects long paths before creating anything to respect macOS socket limits", async () => {
  const parent = join(await root(), "a".repeat(70));
  await mkdir(parent);
  await expect(createTmuxScope(parent)).rejects.toThrow("short");
  expect(await readdir(parent)).toEqual([]);
});
it("removes inherited session selectors, config overrides, shell startup hooks and credentials", () => {
  const source = {
    HOME: "/personal",
    PATH: "/usr/bin",
    FM_HOME: "/managed",
    FM_ROOT_OVERRIDE: "/pinned",
    TMUX: "/personal/socket,1,0",
    TMUX_TMPDIR: "/personal",
    FM_BACKEND: "herdr",
    FM_CONFIG_OVERRIDE: "/personal/config",
    HERDR_SESSION_ID: "personal",
    BASH_ENV: "/personal/startup",
    OPENAI_API_KEY: "secret",
  };
  expect(tmuxEnvironment("/tmp/amun-private", source)).toEqual({
    HOME: "/personal",
    PATH: "/usr/bin",
    FM_HOME: "/managed",
    FM_ROOT_OVERRIDE: "/pinned",
    TMUX_TMPDIR: "/tmp/amun-private",
    FM_BACKEND: "tmux",
    TERM: "xterm-256color",
  });
  expect(source.TMUX).toBe("/personal/socket,1,0");
});
it("rejects relative socket roots", () => {
  expect(() =>
    tmuxEnvironment("relative", { HOME: "/home", PATH: "/bin" }),
  ).toThrow();
});
