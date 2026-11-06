import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createTmuxScope,
  tmuxEnvironment,
} from "../packages/crew/src/tmux-scope.ts";
const exec = promisify(execFile);
const scopes: string[] = [];
const environments: NodeJS.ProcessEnv[] = [];
async function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return (
    await exec(command, args, { env, timeout: 10000, maxBuffer: 65536 })
  ).stdout.trim();
}
try {
  for (let i = 0; i < 2; i++) {
    const scope = await createTmuxScope();
    scopes.push(scope);
    const home = join(scope, "home");
    await mkdir(home, { mode: 0o700 });
    const env = tmuxEnvironment(scope, {
      HOME: home,
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      FM_HOME: home,
      FM_ROOT_OVERRIDE: resolve("apps/desktop/.runtime/firstmate"),
      TMUX: "/unrelated/socket,1,0",
      FM_BACKEND: "herdr",
    });
    environments.push(env);
    // Disable personal/system tmux configuration; create a synthetic session, never a real user's server.
    await run(
      "tmux",
      ["-f", "/dev/null", "new-session", "-d", "-s", "firstmate", "sleep 120"],
      env,
    );
  }
  const [personal, amun] = environments;
  assert(personal && amun);
  const socket = (env: NodeJS.ProcessEnv) =>
    run(
      "tmux",
      ["display-message", "-p", "-t", "firstmate", "#{socket_path}"],
      env,
    );
  assert.notEqual(await socket(personal), await socket(amun));
  // Exercise the pinned adapter through its supported loader, with inherited TMUX removed.
  const adapter =
    '. "$FM_ROOT_OVERRIDE/bin/fm-backend.sh"; fm_backend_source tmux; fm_backend_tmux_container_ensure';
  assert.equal(await run("bash", ["-c", adapter], amun), "firstmate");
  const before = await run(
    "tmux",
    ["display-message", "-p", "-t", "firstmate", "#{pane_pid}"],
    personal,
  );
  await run("tmux", ["kill-server"], amun);
  assert.equal(
    await run(
      "tmux",
      ["display-message", "-p", "-t", "firstmate", "#{pane_pid}"],
      personal,
    ),
    before,
  );
  console.log(
    JSON.stringify({
      independentSockets: true,
      pinnedAdapterReusedScopedSession: true,
      otherSessionSurvivedShutdown: true,
      workerDispatches: 0,
    }),
  );
} finally {
  // Only address servers allocated by this probe; never run unscoped cleanup.
  for (const env of environments) {
    await run("tmux", ["kill-server"], env).catch(() => {});
  }
  for (const scope of scopes) await rm(scope, { recursive: true, force: true });
}
