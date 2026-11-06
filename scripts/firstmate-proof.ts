import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createManagedHome } from "../packages/crew/src/managed-home.ts";
import { JsonLineDecoder } from "../packages/crew/src/jsonl.ts";

const root = await realpath(
  await mkdtemp(join(tmpdir(), "amun-firstmate-proof-")),
);
const distribution = resolve(
  process.argv[2] ?? "apps/desktop/.runtime/firstmate",
);
const personal = join(root, "personal");
const personalConfig = join(personal, ".pi/agent");
await mkdir(personalConfig, { recursive: true, mode: 0o700 });
const sentinel = '{"test-sentinel":"must-remain-untouched"}';
await writeFile(join(personalConfig, "settings.json"), sentinel, {
  mode: 0o600,
});
const operational = await createManagedHome(root, "managed", {});
const config = join(root, "pi-config");
await mkdir(config, { mode: 0o700 });
const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH ?? "",
  HOME: personal,
  PI_CODING_AGENT_DIR: config,
  PI_SKIP_VERSION_CHECK: "1",
  PI_OFFLINE: "1",
  FM_HOME: operational,
  FM_ROOT_OVERRIDE: distribution,
};
if (process.argv[4]) env.ELECTRON_RUN_AS_NODE = "1";
const child = spawn(
  process.argv[4] ?? process.execPath,
  [
    process.argv[3] ??
      resolve(
        "runtime/pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/rpc-entry.js",
      ),
    "--no-session",
    "--offline",
    "--approve",
  ],
  { cwd: distribution, env, stdio: ["pipe", "pipe", "pipe"] },
);
child.stdout.setEncoding("utf8");
const decoder = new JsonLineDecoder();
let diagnostic = "";
child.stderr.on("data", (chunk) => {
  diagnostic = (diagnostic + String(chunk)).slice(-4000);
});
try {
  await new Promise<void>((done, reject) => {
    let refusedWithoutLock = false;
    let commandHandled = false;
    const timer = setTimeout(
      () => reject(new Error("Firstmate startup timed out")),
      20000,
    );
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Firstmate runtime exited (${code})`));
    });
    child.stdout.on("data", (chunk: string) => {
      try {
        for (const frame of decoder.push(chunk)) {
          if (!frame || typeof frame !== "object") continue;
          const response = frame as {
            type?: string;
            id?: string;
            method?: string;
            message?: string;
            notifyType?: string;
            success?: boolean;
            data?: { commands?: { name: string }[]; disposition?: string };
          };
          if (response.type === "agent_start")
            throw new Error("Probe unexpectedly started a model turn");
          if (response.id === "commands") {
            if (
              !response.success ||
              !response.data?.commands?.some(
                (command) => command.name === "fm-watch-arm-pi",
              )
            )
              throw new Error("Firstmate watcher command was not registered");
            child.stdin.write(
              '{"id":"arm","type":"prompt","message":"/fm-watch-arm-pi"}\n',
            );
          }
          if (
            response.type === "extension_ui_request" &&
            response.method === "notify" &&
            response.notifyType === "warning" &&
            response.message?.startsWith(
              "watcher: not armed - no live session holds the lock",
            )
          )
            refusedWithoutLock = true;
          if (response.id === "arm") {
            if (!response.success || response.data?.disposition !== "handled")
              throw new Error(
                "Watcher command was not handled without a model turn",
              );
            commandHandled = true;
          }
          if (refusedWithoutLock && commandHandled) {
            clearTimeout(timer);
            done();
          }
        }
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
    child.stdin.write('{"id":"commands","type":"get_commands"}\n');
  });
  const personalEntries = (await readdir(personal, { recursive: true })).sort();
  if (
    JSON.stringify(personalEntries) !==
    JSON.stringify([".pi", ".pi/agent", ".pi/agent/settings.json"])
  )
    throw new Error("Personal fixture tree changed");
  const marker = await readFile(
    join(operational, "state/.pi-watch-extension-loaded"),
    "utf8",
  );
  if (!marker.includes(String(child.pid)))
    throw new Error("Watcher marker does not identify this process");
  if (
    (await readFile(join(personalConfig, "settings.json"), "utf8")) !== sentinel
  )
    throw new Error("Personal settings changed");
  if (
    (await readFile(
      join(operational, "config/claude-permission-mode"),
      "utf8",
    )) !== "auto\n"
  )
    throw new Error("Managed permission mode changed");
  if (
    (await readFile(
      join(operational, "config/codex-permission-mode"),
      "utf8",
    )) !== "restricted\n"
  )
    throw new Error("Managed Codex mode changed");
  console.log(
    JSON.stringify({
      watcherCommandRegistered: true,
      missingOwnershipRefusedOverRPC: true,
      watcherMarkerMatchesProcess: true,
      managedPermissionMode: "auto",
      codexPermissionMode: "restricted",
      personalFixtureUnchanged: true,
      modelCalls: 0,
      workerDispatches: 0,
    }),
  );
} catch (error) {
  // This probe has a synthetic HOME and no provider credentials; bounded diagnostics are safe for debugging.
  console.error(diagnostic);
  throw error;
} finally {
  child.kill();
  const force = setTimeout(() => child.kill("SIGKILL"), 3000);
  await new Promise<void>((done) => {
    if (child.exitCode !== null || child.signalCode !== null) done();
    else child.once("exit", () => done());
  });
  clearTimeout(force);
  await rm(root, { recursive: true, force: true });
}
