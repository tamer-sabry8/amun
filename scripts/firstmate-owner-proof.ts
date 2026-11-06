import { promisify } from "node:util";
import { spawn, execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
  stat,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createManagedHome } from "../packages/crew/src/managed-home.ts";
import {
  createTmuxScope,
  tmuxEnvironment,
} from "../packages/crew/src/tmux-scope.ts";
import { PiRpcClient } from "../packages/crew/src/pi-rpc.ts";
const packaged = process.argv.includes("--packaged");
const root = await realpath(await mkdtemp(join(tmpdir(), "amun-owner-")));
const socket = await createTmuxScope();
try {
  const resources = resolve(
    `apps/desktop/out/Amun-darwin-${process.arch}/Amun.app/Contents/Resources`,
  );
  const distribution = packaged
    ? join(resources, "firstmate")
    : resolve("apps/desktop/.runtime/firstmate");
  const entry = packaged
    ? join(
        resources,
        "pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
      )
    : resolve(
        "runtime/pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
      );
  const binary = packaged
    ? resolve(
        `apps/desktop/out/Amun-darwin-${process.arch}/Amun.app/Contents/MacOS/Amun`,
      )
    : process.execPath;
  const home = await createManagedHome(root, "managed", { backend: "tmux" });
  const config = join(root, "pi-config");
  await mkdir(config, { mode: 0o700 });
  const extension = join(root, "owner-proof.ts");
  await writeFile(
    extension,
    `export default function(pi) { pi.registerCommand("amun-owner-proof", {description:"Acquire this isolated proof home's supported session lock",handler:async(_args,ctx)=>{const r=await pi.exec("/bin/bash",[process.env.FM_ROOT_OVERRIDE+"/bin/fm-lock.sh"],{timeout:10000});ctx.ui.notify(r.code===0?"AMUN_OWNER_ACQUIRED":"AMUN_OWNER_REFUSED", "info");}}); }`,
    { mode: 0o600 },
  );
  const env = tmuxEnvironment(socket, {
    HOME: root,
    PATH: "/usr/bin:/bin:/opt/homebrew/bin",
    FM_HOME: home,
    FM_ROOT_OVERRIDE: distribution,
    PI_CODING_AGENT_DIR: config,
    PI_SKIP_VERSION_CHECK: "1",
    PI_OFFLINE: "1",
    ...(packaged ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
  });
  const child = spawn(
    binary,
    [
      entry,
      "--mode",
      "rpc",
      "--no-session",
      "--offline",
      "--approve",
      "--extension",
      extension,
    ],
    { cwd: distribution, env, stdio: ["pipe", "pipe", "pipe"] },
  );
  let outcome = "unobserved";
  let modelTurns = 0;
  let complete: () => void = () => {};
  const observed = new Promise<void>((done) => {
    complete = done;
  });
  const client = new PiRpcClient(
    (line) => {
      child.stdin.write(line);
    },
    (frame) => {
      if (frame.type === "agent_start") {
        modelTurns++;
        outcome = "unexpected_model_turn";
      }
      if (
        frame.type === "extension_ui_request" &&
        frame.method === "notify" &&
        typeof frame.message === "string" &&
        frame.message.startsWith("AMUN_OWNER_")
      ) {
        outcome = frame.message;
        complete();
      }
    },
  );
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => client.receive(chunk));
  child.stderr.resume();
  child.on("error", () => {
    client.close();
    complete();
  });
  child.on("exit", () => {
    client.close();
    complete();
  });
  child.stdin.on("error", () => {
    client.close();
    complete();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await client.request("prompt", { message: "/amun-owner-proof" }, 15000);
    await Promise.race([
      observed,
      new Promise<void>((done) => {
        timer = setTimeout(done, 15000);
      }),
    ]);
    let lockMatches = false;
    try {
      lockMatches =
        (await readFile(join(home, "state/.lock"), "utf8")).trim() ===
        String(child.pid);
    } catch {
      /* refusal */
    }
    let watcherLive = false;
    if (process.argv.includes("--watch") && lockMatches) {
      await client.request("prompt", { message: "/fm-watch-arm-pi" });
      for (let attempt = 0; attempt < 40; attempt++) {
        try {
          const pid = Number(
            (
              await readFile(join(home, "state/.watch.lock/pid"), "utf8")
            ).trim(),
          );
          const beat = await stat(join(home, "state/.last-watcher-beat"));
          if (
            Number.isSafeInteger(pid) &&
            pid > 1 &&
            Date.now() - beat.mtimeMs < 5000
          ) {
            process.kill(pid, 0);
            watcherLive = true;
            break;
          }
        } catch {
          /* wait for real verified watcher */
        }
        await new Promise((done) => setTimeout(done, 250));
      }
    }
    let recovered = false;
    if (process.argv.includes("--recover") && watcherLive) {
      const originalPid = (
        await readFile(join(home, "state/.watch.lock/pid"), "utf8")
      ).trim();
      await promisify(execFile)(
        "/bin/bash",
        [join(distribution, "bin/fm-watch-arm.sh"), "--stop"],
        { cwd: distribution, env, timeout: 15000 },
      );
      await client.request("prompt", { message: "/fm-watch-arm-pi" });
      for (let attempt = 0; attempt < 40; attempt++) {
        try {
          const nextPid = (
            await readFile(join(home, "state/.watch.lock/pid"), "utf8")
          ).trim();
          const beat = await stat(join(home, "state/.last-watcher-beat"));
          const owner = (
            await readFile(join(home, "state/.lock"), "utf8")
          ).trim();
          if (
            nextPid !== originalPid &&
            Number.isSafeInteger(Number(nextPid)) &&
            Number(nextPid) > 1 &&
            owner === String(child.pid) &&
            Date.now() - beat.mtimeMs < 5000
          ) {
            process.kill(Number(nextPid), 0);
            recovered = true;
            break;
          }
        } catch {
          /* wait for a verified replacement */
        }
        await new Promise((done) => setTimeout(done, 250));
      }
    }
    console.log(
      JSON.stringify({
        packaged,
        outcome,
        lockMatchesPiProcess: lockMatches,
        watcherLive,
        recovered,
        workerDispatches: 0,
        modelTurns,
      }),
    );
    if (
      outcome !== "AMUN_OWNER_ACQUIRED" ||
      !lockMatches ||
      modelTurns !== 0 ||
      (process.argv.includes("--recover") && !recovered) ||
      (process.argv.includes("--watch") && !watcherLive)
    )
      process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    client.close();
    child.stdin.end();
    const force = setTimeout(() => child.kill("SIGKILL"), 3000);
    if (child.exitCode === null && child.signalCode === null)
      await new Promise<void>((done) => child.once("exit", () => done()));
    clearTimeout(force);
    await promisify(execFile)(
      "/bin/bash",
      [join(distribution, "bin/fm-watch-arm.sh"), "--stop"],
      { cwd: distribution, env, timeout: 15000 },
    ).catch(() => {
      process.exitCode = 1;
    });
  }
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(socket, { recursive: true, force: true });
}
