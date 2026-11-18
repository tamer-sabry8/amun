import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  inheritLoginShellEnvWithCache,
  readShellEnvCache,
  shellEnvChanges,
  writeShellEnvCache,
} from "./amun-shell-env-cache.js";

const quiet = { info: () => undefined, warn: () => undefined };
const dir = () => mkdtempSync(join(tmpdir(), "amun-shell-env-"));

describe("the saved login shell environment", () => {
  it("reads the shell on the first launch and saves only what the shell added", () => {
    const cacheFile = join(dir(), "login-shell-env.json");
    const env: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", PATH: "/usr/bin", HOME: "/Users/t" };
    let reads = 0;
    let refreshes = 0;
    const how = inheritLoginShellEnvWithCache({
      cacheFile,
      env,
      inherit: () => {
        reads += 1;
        // The first launch reads quickly so the window is not kept waiting.
        expect(env.PASEO_SHELL_ENV_TIMEOUT_MS).toBe("6000");
        env.PATH = "/opt/homebrew/bin:/usr/bin";
        env.EDITOR = "vim";
      },
      refresh: () => (refreshes += 1),
      logger: quiet,
    });
    // The full read follows out of process.
    expect([how, reads, refreshes]).toEqual(["read", 1, 1]);
    expect(env.PASEO_SHELL_ENV_TIMEOUT_MS).toBeUndefined();
    expect(JSON.parse(readFileSync(cacheFile, "utf8")).env).toEqual({
      PATH: "/opt/homebrew/bin:/usr/bin",
      EDITOR: "vim",
    });
    // The profile may export keys: only the owner can read the copy.
    expect(statSync(cacheFile).mode & 0o777).toBe(0o600);
  });

  it("applies the saved copy at once on later launches and refreshes it without waiting", () => {
    const cacheFile = join(dir(), "login-shell-env.json");
    writeShellEnvCache(cacheFile, "/bin/zsh", { PATH: "/opt/homebrew/bin:/usr/bin" });
    const env: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", PATH: "/usr/bin" };
    let reads = 0;
    let refreshes = 0;
    const how = inheritLoginShellEnvWithCache({
      cacheFile,
      env,
      inherit: () => (reads += 1),
      refresh: () => (refreshes += 1),
      logger: quiet,
    });
    expect([how, reads, refreshes]).toEqual(["cached", 0, 1]);
    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin");
  });

  it("ignores a copy made for another shell, a damaged one, and an empty one", () => {
    const cacheFile = join(dir(), "login-shell-env.json");
    writeShellEnvCache(cacheFile, "/bin/zsh", { PATH: "/a" });
    expect(readShellEnvCache(cacheFile, "/bin/bash")).toBeNull();
    writeFileSync(cacheFile, "{ not json");
    expect(readShellEnvCache(cacheFile, "/bin/zsh")).toBeNull();
    writeFileSync(cacheFile, JSON.stringify({ version: 1, shell: "/bin/zsh", env: {} }));
    expect(readShellEnvCache(cacheFile, "/bin/zsh")).toBeNull();
  });

  it("counts a variable as the shell's only when it was added or changed", () => {
    expect(shellEnvChanges({ A: "1", B: "2" }, { A: "1", B: "3", C: "4" })).toEqual({
      B: "3",
      C: "4",
    });
  });
});
