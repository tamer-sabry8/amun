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
import { wakeAcknowledgement } from "../packages/crew/src/wake-ack.ts";
import { selectedCredential } from "../packages/crew/src/pi-inference.ts";
import { tmpdir, homedir } from "node:os";
import { createFirstmateWorktrees } from "../packages/crew/src/firstmate-worktree.ts";
import {
  createTmuxScope,
  tmuxEnvironment,
} from "../packages/crew/src/tmux-scope.ts";
import { PiRpcClient } from "../packages/crew/src/pi-rpc.ts";
const live = process.argv.includes("--live");
const packaged = process.argv.includes("--packaged");
let proofParent = tmpdir();
if (process.argv.includes("--managed-location")) {
  proofParent = join(homedir(), "Library/Application Support/Amun/firstmate");
  await mkdir(proofParent, { recursive: true, mode: 0o700 });
  const info = await stat(proofParent);
  if (
    (await realpath(proofParent)) !== proofParent ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o077) !== 0
  )
    throw Error("Unsafe managed proof parent");
}
const root = await realpath(await mkdtemp(join(proofParent, "amun-owner-")));
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
  const worktrees = await createFirstmateWorktrees(
    distribution,
    join(root, "git"),
    ["managed"],
  );
  const home = worktrees.homes.managed!;
  for (const directory of ["config", "state", "data", "projects"])
    await mkdir(join(home, directory), { recursive: true, mode: 0o700 });
  for (const [name, value] of Object.entries({
    backend: "tmux",
    "claude-permission-mode": "auto",
    "codex-permission-mode": "restricted",
  }))
    await writeFile(join(home, "config", name), value + "\n", { mode: 0o600 });
  const config = join(root, "pi-config");
  await mkdir(config, { mode: 0o700 });
  const extension = join(root, "owner-proof.ts");
  await writeFile(
    extension,
    `const parseAck = ${wakeAcknowledgement.toString()}; export default function(pi) { pi.registerCommand("amun-wake-ack",{description:"Acknowledge only the handled acceptance signal",handler:async(_args,ctx)=>{ const script=process.env.FM_ROOT_OVERRIDE+"/bin/fm-wake-drain.sh"; const r=await pi.exec("/bin/bash",[script],{timeout:15000}); if(r.code!==0) {ctx.ui.notify("AMUN_ACK_REFUSED","info");return;} const args=parseAck(r.stdout+String.fromCharCode(10)+r.stderr);const ack=await pi.exec("/bin/bash",[script,...args],{timeout:15000});ctx.ui.notify(ack.code===0?"AMUN_ACK_OK":"AMUN_ACK_REFUSED","info");}}); pi.registerCommand("amun-owner-proof", {description:"Acquire this isolated proof home's supported session lock",handler:async(_args,ctx)=>{pi.setActiveTools([]);const r=await pi.exec("/bin/bash",[process.env.FM_ROOT_OVERRIDE+"/bin/fm-lock.sh"],{timeout:10000});ctx.ui.notify(r.code===0?"AMUN_OWNER_ACQUIRED":"AMUN_OWNER_REFUSED", "info");}}); }`,
    { mode: 0o600 },
  );
  const env = tmuxEnvironment(socket, {
    HOME: root,
    PATH: "/usr/bin:/bin:/opt/homebrew/bin",
    FM_HOME: home,
    FM_ROOT_OVERRIDE: home,
    PI_CODING_AGENT_DIR: config,
    PI_SKIP_VERSION_CHECK: "1",
    ...(live ? {} : { PI_OFFLINE: "1" }),
    ...(packaged ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
  });
  if (process.argv.includes("--wake")) {
    // Supported watcher timing knobs, scoped only to this disposable acceptance home.
    env.FM_POLL = "1";
    env.FM_SIGNAL_GRACE = "1";
    env.FM_CHECK_INTERVAL = "999999";
  }
  if (live) {
    const installed = join(
      homedir(),
      ".pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
    );
    let result: string;
    try {
      result = (
        await promisify(execFile)(
          process.execPath,
          [
            installed,
            "auth",
            "check",
            "--provider",
            "openrouter",
            "--json",
            "--credentials",
            "--no-refresh",
          ],
          { timeout: 20000, maxBuffer: 65536 },
        )
      ).stdout;
    } catch {
      throw Error(
        "Selected provider credential unavailable; private details withheld",
      );
    }
    const selected = selectedCredential("openrouter", result);
    result = "";
    env[selected.name] = selected.value;
  }
  const child = spawn(
    binary,
    [
      entry,
      "--mode",
      "rpc",
      "--no-session",
      ...(live
        ? ["--provider", "openrouter", "--model", "openai/gpt-4.1-mini"]
        : ["--offline"]),
      "--approve",
      "--extension",
      extension,
    ],
    { cwd: home, env, stdio: ["pipe", "pipe", "pipe"] },
  );
  delete env.OPENROUTER_API_KEY;
  let successfulStop = false;
  let settled = false;
  let outcome = "unobserved";
  let modelTurns = 0;
  let wakeDelivered = false;
  const notifications: string[] = [];
  let complete: () => void = () => {};
  const observed = new Promise<void>((done) => {
    complete = done;
  });
  const client = new PiRpcClient(
    (line) => {
      child.stdin.write(line);
    },
    (frame) => {
      if (
        frame.type === "message_end" &&
        frame.message &&
        typeof frame.message === "object" &&
        "role" in frame.message &&
        frame.message.role === "assistant" &&
        "stopReason" in frame.message
      )
        successfulStop = frame.message.stopReason === "stop";
      if (frame.type === "agent_settled") settled = frame.aborted === false;
      if (frame.type === "extension_error")
        notifications.push(JSON.stringify(frame).slice(0, 2000));
      if (
        frame.type === "extension_ui_request" &&
        frame.method === "notify" &&
        typeof frame.message === "string"
      )
        notifications.push(frame.message.slice(0, 2000));
      if (
        frame.type === "message_start" &&
        frame.message &&
        typeof frame.message === "object"
      ) {
        const message = frame.message as { role?: string; content?: unknown };
        if (
          message.role === "user" &&
          JSON.stringify(message.content).includes("FIRSTMATE WATCHER WAKE:")
        )
          wakeDelivered = true;
      }
      if (frame.type === "agent_start") {
        modelTurns++;
        if (!process.argv.includes("--wake")) outcome = "unexpected_model_turn";
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
    if (
      (process.argv.includes("--recover") ||
        process.argv.includes("--crash")) &&
      watcherLive
    ) {
      const originalPid = (
        await readFile(join(home, "state/.watch.lock/pid"), "utf8")
      ).trim();
      if (process.argv.includes("--crash")) {
        const pid = Number(originalPid);
        if (!Number.isSafeInteger(pid) || pid < 2)
          throw Error("Invalid owned watcher PID");
        process.kill(pid, "SIGKILL");
      } else {
        await promisify(execFile)(
          "/bin/bash",
          [join(home, "bin/fm-watch-arm.sh"), "--stop"],
          { cwd: home, env, timeout: 15000 },
        );
        await client.request("prompt", { message: "/fm-watch-arm-pi" });
      }
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
    let automaticRearm = false;
    if (process.argv.includes("--wake") && watcherLive) {
      const prior = (
        await readFile(join(home, "state/.watch.lock/pid"), "utf8")
      ).trim();
      await writeFile(
        join(home, "state/acceptance.status"),
        "done: acceptance wake delivery probe; no worker action required\n",
        { mode: 0o600, flag: "wx" },
      );
      for (let attempt = 0; attempt < 240; attempt++) {
        try {
          const next = (
            await readFile(join(home, "state/.watch.lock/pid"), "utf8")
          ).trim();
          const beat = await stat(join(home, "state/.last-watcher-beat"));
          if (
            wakeDelivered &&
            (!live || (successfulStop && settled)) &&
            next !== prior &&
            Number(next) > 1 &&
            Date.now() - beat.mtimeMs < 5000
          ) {
            process.kill(Number(next), 0);
            automaticRearm = true;
            break;
          }
        } catch {
          /* wait for actual replacement and consumed user wake */
        }
        await new Promise((done) => setTimeout(done, 250));
      }
    }
    let acknowledged = false;
    if (live && successfulStop && settled && automaticRearm) {
      await client.request("prompt", { message: "/amun-wake-ack" }, 20000);
      for (let i = 0; i < 80; i++) {
        if (notifications.includes("AMUN_ACK_OK")) {
          acknowledged = true;
          break;
        }
        if (notifications.includes("AMUN_ACK_REFUSED")) break;
        await new Promise((done) => setTimeout(done, 250));
      }
      if (acknowledged) {
        const queue = await readFile(
          join(home, "state/.wake-queue"),
          "utf8",
        ).catch(() => "");
        acknowledged = !queue.includes("acceptance.status");
      }
    }
    console.log(
      JSON.stringify({
        packaged,
        outcome,
        lockMatchesPiProcess: lockMatches,
        realGitWorktree: true,
        watcherLive,
        recovered,
        wakeDelivered,
        automaticRearm,
        wakeModelHandling: live
          ? "authenticated no-tool consumption"
          : "not tested: offline delivery probe",
        acknowledged,
        successfulStop,
        settled,
        workerDispatches: 0,
        modelTurns,
      }),
    );
    if (
      (live && !acknowledged) ||
      outcome !== "AMUN_OWNER_ACQUIRED" ||
      !lockMatches ||
      (!process.argv.includes("--wake") && modelTurns !== 0) ||
      (process.argv.includes("--wake") &&
        (!wakeDelivered || !automaticRearm)) ||
      ((process.argv.includes("--recover") ||
        process.argv.includes("--crash")) &&
        !recovered) ||
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
      [join(home, "bin/fm-watch-arm.sh"), "--stop"],
      { cwd: home, env, timeout: 15000 },
    ).catch(() => {
      process.exitCode = 1;
    });
  }
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(socket, { recursive: true, force: true });
}
